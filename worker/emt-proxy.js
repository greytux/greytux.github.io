// emt-proxy.js — Cloudflare Worker que autentica contra la API de EMT Madrid
// y reenvía las peticiones. Las credenciales viven como SECRETOS del Worker
// (env.EMT_EMAIL / env.EMT_PASSWORD), nunca en el cliente ni en el repo.
//
// El cliente (la PWA) llama a este Worker en lugar de a EMT directamente, así
// que las respuestas JSON son las mismas que devolvía EMT y la app no necesita
// cambiar su lógica de parseo.

const V1 = "https://openapi.emtmadrid.es/v1";
const V2 = "https://openapi.emtmadrid.es/v2";

// Orígenes autorizados a usar el proxy (evita que terceros lo usen desde otra web).
const ALLOWED_ORIGINS = [
    "https://greytux.github.io",
    "http://localhost:8000",
    "http://127.0.0.1:8000"
];

// Token cacheado a nivel de isolate. Cloudflare reutiliza el isolate entre
// peticiones cercanas, así que esto evita relogin en cada llamada.
let cachedToken = null;
let cachedExp = 0;

function corsHeaders(origin) {
    const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
    };
}

function jsonResponse(data, origin, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
    });
}

async function login(env) {
    const res = await fetch(`${V2}/mobilitylabs/user/login/`, {
        headers: { email: env.EMT_EMAIL, password: env.EMT_PASSWORD }
    });
    const data = await res.json();
    if (data.code !== "00" && data.code !== "01") {
        throw new Error("login_failed: " + (data.description || data.code));
    }
    const d0 = data.data && data.data[0];
    const token = d0 && d0.accessToken;
    if (!token) throw new Error("login_no_token");
    const secs = Number.isFinite(d0.tokenSecExpiration) ? d0.tokenSecExpiration : 1500;
    cachedToken = token;
    cachedExp = Date.now() + secs * 1000 - 60000; // margen de 1 min
    return token;
}

function getToken(env) {
    if (cachedToken && Date.now() < cachedExp) return Promise.resolve(cachedToken);
    return login(env);
}

// Petición autenticada a EMT. Si el token caducó (code 01/02), renueva y
// reintenta una vez.
async function emtFetch(env, url, init = {}, _retry = 0) {
    const token = await getToken(env);
    const res = await fetch(url, {
        ...init,
        headers: { ...(init.headers || {}), accessToken: token }
    });
    const data = await res.json();
    if ((data.code === "01" || data.code === "02") && _retry < 1) {
        cachedToken = null;
        return emtFetch(env, url, init, _retry + 1);
    }
    return data;
}

// Tiempo de cache por tipo de endpoint (segundos). Las llegadas se cachean
// pocos segundos (son "tiempo real" pero el cliente refresca cada 45s); el
// detalle de parada es casi estático; las cercanas, un valor intermedio.
const TTL = { arrives: 15, detail: 21600, nearby: 30, incidents: 600 };

// Devuelve la respuesta cacheada si existe; si no, la produce, la cachea (solo
// si EMT respondió code "00") y la devuelve. Cacheamos solo los DATOS (sin
// cabeceras CORS) y reaplicamos CORS por petición, para no servir el
// Access-Control-Allow-Origin de un origen a otro.
async function cachedJson(request, ctx, kind, origin, producer) {
    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });

    const hit = await cache.match(cacheKey);
    if (hit) {
        const data = await hit.json();
        return jsonResponse(data, origin);
    }

    const data = await producer();
    if (data && data.code === "00") {
        const toCache = new Response(JSON.stringify(data), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": `max-age=${TTL[kind]}`
            }
        });
        ctx.waitUntil(cache.put(cacheKey, toCache));
    }
    return jsonResponse(data, origin);
}

export default {
    async fetch(request, env, ctx) {
        const origin = request.headers.get("Origin") || "";

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        const url = new URL(request.url);
        const parts = url.pathname.split("/").filter(Boolean); // ej: ["api","arrives","2677"]

        if (parts[0] !== "api") {
            return jsonResponse({ error: "not_found" }, origin, 404);
        }

        try {
            // /api/arrives/:stopId  → llegadas en tiempo real
            if (parts[1] === "arrives" && parts[2]) {
                const stopId = parts[2];
                return cachedJson(request, ctx, "arrives", origin, () =>
                    emtFetch(
                        env,
                        `${V2}/transport/busemtmad/stops/${stopId}/arrives/`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                stopId,
                                Text_EstimationsRequired_YN: "Y",
                                Urban_UseYN: "Y"
                            })
                        }
                    )
                );
            }

            // /api/detail/:stopId?v=1|2  → detalle de parada (coords + líneas)
            if (parts[1] === "detail" && parts[2]) {
                const stopId = parts[2];
                const base = url.searchParams.get("v") === "2" ? V2 : V1;
                return cachedJson(request, ctx, "detail", origin, () =>
                    emtFetch(
                        env,
                        `${base}/transport/busemtmad/stops/${stopId}/detail/`,
                        { method: "GET" }
                    )
                );
            }

            // /api/incidents  → incidencias/avisos de todas las líneas
            if (parts[1] === "incidents") {
                return cachedJson(request, ctx, "incidents", origin, () =>
                    emtFetch(
                        env,
                        `${V1}/transport/busemtmad/lines/incidents/all/`,
                        { method: "GET" }
                    )
                );
            }

            // /api/nearby/:lon/:lat/:radius  → paradas cercanas
            if (parts[1] === "nearby" && parts[4]) {
                const lon = parts[2];
                const lat = parts[3];
                const radius = parts[4];
                return cachedJson(request, ctx, "nearby", origin, () =>
                    emtFetch(
                        env,
                        `${V2}/transport/busemtmad/stops/arroundxy/${lon}/${lat}/${radius}/`,
                        { method: "GET" }
                    )
                );
            }

            return jsonResponse({ error: "not_found" }, origin, 404);
        } catch (e) {
            return jsonResponse(
                { error: "proxy_error", message: String((e && e.message) || e) },
                origin,
                502
            );
        }
    }
};
