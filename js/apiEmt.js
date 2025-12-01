// apiEmt.js
import {
    BASE_URL_V1,
    BASE_URL_V2,
    STOP_COORDS,
    STOP_LINES,
    activateApiCooldown,
    isApiInCooldown
} from "./state.js";

const USER = "diegojesus.escudero@gmail.com";
const PASS = "Linares251291?";

let accessToken = null;

export function normalizeLinePublic(raw) {
    if (!raw) return "";
    return String(raw).trim().replace(/^0+/, "");
}

async function safeFetch(url, options) {
    if (isApiInCooldown()) {
        throw new Error("API_COOLDOWN");
    }

    const res = await fetch(url, options);

    // Detectamos límite de API
    if (res.status === 429) {
        activateApiCooldown();
        throw new Error("API_LIMIT_REACHED");
    }

    const json = await res.json();

    if (
        json.description?.includes("Limit use API reached") ||
        json.code === "88"
    ) {
        activateApiCooldown();
        throw new Error("API_LIMIT_REACHED");
    }

    return json;
}

// LOGIN
export async function login() {
    const json = await safeFetch(`${BASE_URL_V2}/mobilitylabs/user/login/`, {
        method: "GET",
        headers: {
            email: USER,
            password: PASS
        }
    });

    if (json.code !== "00" && json.code !== "01") {
        throw new Error("Login EMT falló: " + (json.description || json.code));
    }

    accessToken = json.data[0].accessToken;
    return accessToken;
}

// Llegadas
export async function getArrivals(stopId) {
    if (isApiInCooldown()) throw new Error("API_COOLDOWN");

    if (!accessToken) await login();

    const json = await safeFetch(
        `${BASE_URL_V2}/transport/busemtmad/stops/${stopId}/arrives/`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                accessToken
            },
            body: JSON.stringify({
                stopId,
                Text_EstimationsRequired_YN: "Y",
                Urban_UseYN: "Y"
            })
        }
    );

    if (json.code !== "00") {
        if (json.code === "01" || json.code === "02") {
            accessToken = null;
            return getArrivals(stopId);
        }
    }

    return json.data?.[0]?.Arrive || [];
}

// Detalle de parada (coords + líneas)
export async function fetchStopCoords(stopId) {
    if (STOP_COORDS[stopId] && STOP_LINES[stopId]) return STOP_COORDS[stopId];

    if (!accessToken) await login();

    const json = await safeFetch(
        `${BASE_URL_V1}/transport/busemtmad/stops/${stopId}/detail/`,
        { method: "GET", headers: { accessToken } }
    );

    const stop = json.data?.[0]?.stops?.[0];
    if (!stop) return null;

    if (stop.geometry?.coordinates) {
        const [lon, lat] = stop.geometry.coordinates;
        STOP_COORDS[stopId] = { lat, lon };
    }

    STOP_LINES[stopId] =
        stop.dataLine?.map(l => normalizeLinePublic(l.label)) || [];

    return STOP_COORDS[stopId];
}

// Paradas cercanas
export async function getNearbyStops(userLocation, radius = 400) {
    if (isApiInCooldown()) throw new Error("API_COOLDOWN");

    if (!accessToken) await login();

    const { lat, lon } = userLocation;

    const json = await safeFetch(
        `${BASE_URL_V2}/transport/busemtmad/stops/arroundxy/${lon}/${lat}/${radius}/`,
        { method: "GET", headers: { accessToken } }
    );

    const d0 = json.data?.[0];
    return d0?.stops || d0?.Stops || d0?.Stop || [];
}
