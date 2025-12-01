import {
    BASE_URL_V1,
    BASE_URL_V2,
    STOP_COORDS,
    STOP_LINES,
    activateApiCooldown,
    isApiInCooldown
} from "./state.js";

// TODO -> ocultar
const USER = "diegojesus.escudero@gmail.com";
const PASS = "Linares251291?";

let accessToken = null;

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
        throw new Error("Login EMT falló: " + (json.description || json.code));
    }

    accessToken = json.data[0].accessToken;
    return accessToken;
}

// --- LLEGADAS PARADA ---
export async function getArrivals(stopId) {
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
        if (json.code === "01" || json.code === "02") {
            accessToken = null;
            return getArrivals(stopId);
        }
        throw new Error("Error API arrives (" + stopId + "): " + (json.description || json.code));
    }

    const data = json.data && json.data[0] && json.data[0].Arrive
        ? json.data[0].Arrive
        : [];

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

export async function fetchStopCoords(stopId) {
    if (STOP_COORDS[stopId] && STOP_LINES[stopId]) return STOP_COORDS[stopId];

    if (isApiInCooldown()) {
        throw new Error("API_COOLDOWN");
    }

    if (!accessToken) {
        await login();
    }

    const res = await fetch(
        `${BASE_URL_V1}/transport/busemtmad/stops/${stopId}/detail/`,
        {
            method: "GET",
            headers: {
                "accessToken": accessToken
            }
        }
    );

    if (!res.ok) {
        console.warn("Error HTTP en detalle de parada:", res.status);
        return null;
    }

    const json = await res.json();
    console.log("DETAIL JSON stop", stopId, json);

    if (isLimitErrorJson(json)) {
        activateApiCooldown();
        throw new Error("API_LIMIT_REACHED");
    }

    if (json.code !== "00") {
        console.warn("Error API detalle parada:", json.description || json.code);
        return null;
    }

    let lat = null;
    let lon = null;

    if (
        Array.isArray(json.data) &&
        json.data.length > 0 &&
        json.data[0].stops &&
        Array.isArray(json.data[0].stops) &&
        json.data[0].stops.length > 0
    ) {
        const stopObj = json.data[0].stops[0];

        if (
            stopObj.geometry &&
            Array.isArray(stopObj.geometry.coordinates) &&
            stopObj.geometry.coordinates.length >= 2
        ) {
            const coords = stopObj.geometry.coordinates;
            lon = parseFloat(coords[0]); // [lon, lat]
            lat = parseFloat(coords[1]);
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

    console.warn("No se han podido extraer coords válidas para la parada", stopId);
    return null;
}

// --- PARADAS CERCANAS ---
export async function getNearbyStops() {
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
        if (json.code === "01" || json.code === "02") {
            accessToken = null;
            return getNearbyStops();
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
