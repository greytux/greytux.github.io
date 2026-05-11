import {
    BASE_URL_V1,
    BASE_URL_V2,
    STOP_COORDS,
    STOP_LINES,
    activateApiCooldown,
    isApiInCooldown,
    getStoredToken,
    setStoredToken,
    clearStoredToken
} from "./state.js";

import { trackArrivals } from "./etaTracker.js";

// TODO -> ocultar
const USER = "diegojesus.escudero@gmail.com";
const PASS = "Linares251291?";

// Si ya tenemos un token válido en localStorage lo reutilizamos:
// así evitamos hacer login en cada recarga.
let accessToken = getStoredToken();

// Lifespan por defecto si la API no nos dice nada (25 min, conservador).
const DEFAULT_TOKEN_LIFESPAN_MS = 25 * 60 * 1000;

function deriveTokenExpiry(data0) {
    if (!data0) return Date.now() + DEFAULT_TOKEN_LIFESPAN_MS;

    if (
        data0.tokenDteExpiration &&
        typeof data0.tokenDteExpiration === "object" &&
        Number.isFinite(data0.tokenDteExpiration.$date)
    ) {
        return Number(data0.tokenDteExpiration.$date);
    }

    if (Number.isFinite(data0.tokenSecExpiration)) {
        return Date.now() + data0.tokenSecExpiration * 1000;
    }

    return Date.now() + DEFAULT_TOKEN_LIFESPAN_MS;
}

function invalidateToken() {
    accessToken = null;
    clearStoredToken();
}

function isLimitErrorJson(json) {
    if (!json) return false;
    if (typeof json.description === "string" &&
        json.description.toLowerCase().includes("limit use api reached")) {
        return true;
    }
    return false;
}

// --- LOGIN EMT ---
async function login() {
    if (isApiInCooldown()) {
        throw new Error("API_COOLDOWN");
    }

    const res = await fetch(`${BASE_URL_V2}/mobilitylabs/user/login/`, {
        method: "GET",
        headers: {
            "email": USER,
            "password": PASS
        }
    });

    if (!res.ok) {
        throw new Error("Error HTTP en login: " + res.status);
    }

    const json = await res.json();
    console.log("LOGIN JSON", json);

    if (isLimitErrorJson(json)) {
        activateApiCooldown();
        throw new Error("API_LIMIT_REACHED");
    }

    if (json.code !== "00" && json.code !== "01") {
        invalidateToken();
        throw new Error("Login EMT falló: " + (json.description || json.code));
    }

    const data0 = json.data && json.data[0];
    accessToken = data0 && data0.accessToken;
    if (!accessToken) {
        invalidateToken();
        throw new Error("Login EMT no devolvió accessToken");
    }
    setStoredToken(accessToken, deriveTokenExpiry(data0));
    return accessToken;
}

// --- LLEGADAS PARADA ---
const MAX_AUTH_RETRIES = 1;

export async function getArrivals(stopId, _retries = 0) {
    if (isApiInCooldown()) {
        throw new Error("API_COOLDOWN");
    }

    if (!accessToken) {
        await login();
    }

    const res = await fetch(
        `${BASE_URL_V2}/transport/busemtmad/stops/${stopId}/arrives/`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "accessToken": accessToken
            },
            body: JSON.stringify({
                stopId: stopId,
                Text_EstimationsRequired_YN: "Y",
                Urban_UseYN: "Y"
            })
        }
    );

    if (!res.ok) {
        throw new Error("Error HTTP en arrives (" + stopId + "): " + res.status);
    }

    const json = await res.json();
    console.log("ARRIVES JSON stop", stopId, json);

    if (isLimitErrorJson(json)) {
        activateApiCooldown();
        throw new Error("API_LIMIT_REACHED");
    }

    if (json.code !== "00") {
        if ((json.code === "01" || json.code === "02") && _retries < MAX_AUTH_RETRIES) {
            invalidateToken();
            return getArrivals(stopId, _retries + 1);
        }
        throw new Error("Error API arrives (" + stopId + "): " + (json.description || json.code));
    }

    const data0 = json.data && json.data[0];
    const data = data0 && data0.Arrive ? data0.Arrive : [];

    // Aprovechamos los arrivals para cachear las líneas que pasan por la
    // parada. Así fetchStopCoords no entra en bucle reintentando /detail/
    // si las coords ya están manualmente fijadas pero las líneas no.
    if (!STOP_LINES[stopId] && Array.isArray(data) && data.length > 0) {
        const linesSet = new Set();
        data.forEach(a => {
            const l = String(a.line || "").trim().replace(/^0+/, "");
            if (l) linesSet.add(l);
        });
        if (linesSet.size > 0) {
            STOP_LINES[stopId] = [...linesSet];
        }
    }

    // Fallback de coordenadas: algunas paradas (p.ej. 2677) no exponen
    // geometry vía /detail/, pero sí dentro de StopInfo de /arrives/.
    // Si todavía no tenemos coords cacheadas para esta parada, las
    // intentamos extraer aquí.
    try {
        const stopInfo = data0 && (
            (Array.isArray(data0.StopInfo) && data0.StopInfo[0]) ||
            (Array.isArray(data0.stopInfo) && data0.stopInfo[0]) ||
            null
        );
        if (stopInfo && !STOP_COORDS[stopId]) {
            let lat = null;
            let lon = null;

            if (
                stopInfo.geometry &&
                Array.isArray(stopInfo.geometry.coordinates) &&
                stopInfo.geometry.coordinates.length >= 2
            ) {
                lon = parseFloat(stopInfo.geometry.coordinates[0]);
                lat = parseFloat(stopInfo.geometry.coordinates[1]);
            }
            if ((lat == null || Number.isNaN(lat)) && stopInfo.latitude != null) {
                lat = parseFloat(stopInfo.latitude);
            }
            if ((lon == null || Number.isNaN(lon)) && stopInfo.longitude != null) {
                lon = parseFloat(stopInfo.longitude);
            }

            if (
                lat != null && lon != null &&
                !Number.isNaN(lat) && !Number.isNaN(lon)
            ) {
                STOP_COORDS[stopId] = { lat, lon };
                console.log("Coords parada (vía arrives)", stopId, STOP_COORDS[stopId]);
            }
        }
    } catch (e) {
        console.warn("No se pudieron extraer coords de StopInfo", e);
    }

    // Registrar ETAs para poder detectar buses retrasados
    trackArrivals(stopId, data);

    return data;
}

// --- DETALLE DE PARADA: coords + líneas ---
function normalizeLineLocal(l) {
    if (l == null) return "";
    return String(l).trim().replace(/^0+/, "");
}

function getStopLinesFromRawStop(rawStop) {
    if (!rawStop) return [];

    if (Array.isArray(rawStop.dataLine)) {
        return rawStop.dataLine
            .map(l => normalizeLineLocal(l.label || l.line))
            .filter(Boolean);
    }

    if (Array.isArray(rawStop.lines)) {
        return rawStop.lines.map(l => normalizeLineLocal(l));
    }

    if (typeof rawStop.lines === "string") {
        const matches = rawStop.lines.match(/\d+/g);
        return matches ? matches.map(x => normalizeLineLocal(x)) : [];
    }

    return [];
}

async function fetchStopDetailRaw(stopId, baseUrl) {
    const res = await fetch(
        `${baseUrl}/transport/busemtmad/stops/${stopId}/detail/`,
        {
            method: "GET",
            headers: {
                "accessToken": accessToken
            }
        }
    );

    if (!res.ok) {
        return { ok: false, status: res.status };
    }

    const json = await res.json();
    return { ok: true, json };
}

export async function fetchStopCoords(stopId) {
    if (STOP_COORDS[stopId] && STOP_LINES[stopId]) return STOP_COORDS[stopId];

    if (isApiInCooldown()) {
        throw new Error("API_COOLDOWN");
    }

    if (!accessToken) {
        await login();
    }

    // Intentamos primero V1; si devuelve 81 (No records) o similar,
    // probamos V2 antes de rendirnos. Algunas paradas (p.ej. 2677) no
    // existen en V1 pero sí en V2.
    let attempt = await fetchStopDetailRaw(stopId, BASE_URL_V1);
    if (!attempt.ok) {
        console.warn("Error HTTP en detalle V1 de parada:", stopId, attempt.status);
        attempt = await fetchStopDetailRaw(stopId, BASE_URL_V2);
        if (!attempt.ok) {
            console.warn("Error HTTP en detalle V2 de parada:", stopId, attempt.status);
            return null;
        }
    }

    let json = attempt.json;
    console.log("DETAIL JSON stop", stopId, json);

    if (isLimitErrorJson(json)) {
        activateApiCooldown();
        throw new Error("API_LIMIT_REACHED");
    }

    // Si V1 dio code distinto de 00, reintentar con V2
    if (json.code !== "00") {
        console.warn(
            "Detalle V1 falló para parada", stopId, ":",
            json.description || json.code, "— probando V2"
        );
        const attempt2 = await fetchStopDetailRaw(stopId, BASE_URL_V2);
        if (attempt2.ok) {
            console.log("DETAIL V2 JSON stop", stopId, attempt2.json);
            if (isLimitErrorJson(attempt2.json)) {
                activateApiCooldown();
                throw new Error("API_LIMIT_REACHED");
            }
            if (attempt2.json.code === "00") {
                json = attempt2.json;
            } else {
                console.warn(
                    "Detalle V2 también falló para parada", stopId, ":",
                    attempt2.json.description || attempt2.json.code
                );
                return null;
            }
        } else {
            return null;
        }
    }

    // EMT devuelve la información de la parada en varias formas posibles:
    //   1) json.data[0].stops[0]   (la forma más común)
    //   2) json.data[0].Stops[0]   (variante de mayúsculas)
    //   3) json.data[0]            (a veces el stop está directamente)
    // También las coordenadas pueden venir en geometry.coordinates [lon,lat] o
    // en campos planos longitude/latitude.
    let stopObj = null;
    if (Array.isArray(json.data) && json.data.length > 0) {
        const d0 = json.data[0];
        if (d0 && Array.isArray(d0.stops) && d0.stops.length > 0) {
            stopObj = d0.stops[0];
        } else if (d0 && Array.isArray(d0.Stops) && d0.Stops.length > 0) {
            stopObj = d0.Stops[0];
        } else if (
            d0 &&
            typeof d0 === "object" &&
            (d0.geometry || d0.longitude != null || d0.latitude != null ||
             d0.stopId != null || d0.IdStop != null)
        ) {
            stopObj = d0;
        }
    }

    let lat = null;
    let lon = null;

    if (stopObj) {
        if (
            stopObj.geometry &&
            Array.isArray(stopObj.geometry.coordinates) &&
            stopObj.geometry.coordinates.length >= 2
        ) {
            const coords = stopObj.geometry.coordinates;
            lon = parseFloat(coords[0]); // [lon, lat]
            lat = parseFloat(coords[1]);
        }

        // Fallback: longitude/latitude planos
        if ((lat == null || Number.isNaN(lat)) &&
            stopObj.latitude != null &&
            Number.isFinite(parseFloat(stopObj.latitude))) {
            lat = parseFloat(stopObj.latitude);
        }
        if ((lon == null || Number.isNaN(lon)) &&
            stopObj.longitude != null &&
            Number.isFinite(parseFloat(stopObj.longitude))) {
            lon = parseFloat(stopObj.longitude);
        }

        const lines = getStopLinesFromRawStop(stopObj);
        if (lines.length) {
            STOP_LINES[stopId] = lines;
        }
    }

    if (lat != null && lon != null && !Number.isNaN(lat) && !Number.isNaN(lon)) {
        STOP_COORDS[stopId] = { lat, lon };
        console.log("Coords parada", stopId, STOP_COORDS[stopId]);
        return STOP_COORDS[stopId];
    }

    console.warn(
        "No se han podido extraer coords válidas para la parada", stopId,
        "— estructura recibida:", json
    );
    return null;
}

// --- PARADAS CERCANAS ---
export async function getNearbyStops(_retries = 0) {
    if (isApiInCooldown()) {
        throw new Error("API_COOLDOWN");
    }

    if (!accessToken) {
        await login();
    }

    if (!navigator.geolocation) {
        throw new Error("NO_LOCATION");
    }

    const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000
        });
    });

    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const radius = 400;

    const res = await fetch(
        `${BASE_URL_V2}/transport/busemtmad/stops/arroundxy/${lon}/${lat}/${radius}/`,
        {
            method: "GET",
            headers: {
                "accessToken": accessToken
            }
        }
    );

    if (!res.ok) {
        throw new Error("Error HTTP en paradas cercanas: " + res.status);
    }

    const json = await res.json();
    console.log("NEARBY JSON", json);

    if (isLimitErrorJson(json)) {
        activateApiCooldown();
        throw new Error("API_LIMIT_REACHED");
    }

    if (json.code !== "00") {
        if ((json.code === "01" || json.code === "02") && _retries < MAX_AUTH_RETRIES) {
            invalidateToken();
            return getNearbyStops(_retries + 1);
        }
        throw new Error("Error API paradas cercanas: " + (json.description || json.code));
    }

    let stopsArr = [];

    if (Array.isArray(json.data) && json.data.length > 0) {
        const d0 = json.data[0];
        if (Array.isArray(d0.stops)) stopsArr = d0.stops;
        else if (Array.isArray(d0.Stops)) stopsArr = d0.Stops;
        else if (Array.isArray(d0.Stop)) stopsArr = d0.Stop;
        else if (Array.isArray(json.data)) stopsArr = json.data;
    }

    return stopsArr;
}

// --- GEOLOCALIZACIÓN sencilla: devolver coords sin tocar DOM ---
export async function updateUserLocation() {
    if (!("geolocation" in navigator)) {
        throw new Error("NO_LOCATION");
    }

    const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000
        });
    });

    const loc = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
    };
    console.log("Ubicación del usuario:", loc);
    return loc;
}
