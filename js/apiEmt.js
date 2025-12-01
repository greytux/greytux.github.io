// js/apiEmt.js
import {
    API_COOLDOWN_MS,
    BASE_URL_V1, BASE_URL_V2,
    EMT_USER, EMT_PASS,
    accessToken, setAccessToken,
    apiCooldownUntil, setApiCooldownUntil,
    STOP_COORDS, STOP_LINES,
    userLocation
} from "./state.js";

export function isInApiCooldown() {
    return Date.now() < apiCooldownUntil;
}

// Cuando la API devuelve "Limit use API reached"
export function activateApiCooldown() {
    const until = Date.now() + API_COOLDOWN_MS;
    setApiCooldownUntil(until);
    console.warn("API cooldown activado hasta:", new Date(until).toLocaleTimeString());
}

export function isLimitError(json) {
    const desc = (json && json.description) || "";
    return typeof desc === "string" && desc.toLowerCase().includes("limit use api");
}

export async function login() {
    if (isInApiCooldown()) {
        throw new Error("Límite de uso de la API EMT. Espera unos minutos.");
    }

    const res = await fetch(`${BASE_URL_V2}/mobilitylabs/user/login/`, {
        method: "GET",
        headers: {
            "email": EMT_USER,
            "password": EMT_PASS
        }
    });

    if (!res.ok) {
        throw new Error("Error HTTP en login: " + res.status);
    }

    const json = await res.json();
    if (json.code !== "00" && json.code !== "01") {
        if (isLimitError(json)) {
            activateApiCooldown();
            throw new Error("Límite de uso de la API EMT. Espera unos minutos.");
        }
        throw new Error("Login EMT falló: " + (json.description || json.code));
    }

    setAccessToken(json.data[0].accessToken);
    return accessToken;
}

export async function getArrivals(stopId) {
    if (isInApiCooldown()) {
        throw new Error("Límite de uso de la API EMT. Espera unos minutos.");
    }

    let token = accessToken;
    if (!token) {
        token = await login();
    }

    const res = await fetch(
        `${BASE_URL_V2}/transport/busemtmad/stops/${stopId}/arrives/`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "accessToken": token
            },
            body: JSON.stringify({
                stopId,
                Text_EstimationsRequired_YN: "Y",
                Urban_UseYN: "Y"
            })
        }
    );

    if (!res.ok) {
        throw new Error("Error HTTP en arrives (" + stopId + "): " + res.status);
    }

    const json = await res.json();
    if (json.code !== "00") {
        if (isLimitError(json)) {
            activateApiCooldown();
            throw new Error("Límite de uso de la API EMT. Espera unos minutos.");
        }
        if (json.code === "01" || json.code === "02") {
            setAccessToken(null);
            return getArrivals(stopId);
        }
        throw new Error("Error API arrives (" + stopId + "): " + (json.description || json.code));
    }

    return json.data?.[0]?.Arrive ?? [];
}

export async function fetchStopCoords(stopId) {
    if (STOP_COORDS[stopId] && STOP_LINES[stopId]) return STOP_COORDS[stopId];

    if (isInApiCooldown()) {
        console.warn("En cooldown: no se piden coords para parada", stopId);
        return null;
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

    if (json.code !== "00") {
        if (isLimitError(json)) {
            activateApiCooldown();
            console.warn("Límite de uso de API EMT al pedir coords.");
            return null;
        }
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
        updateLocationLink(stopId);
        return STOP_COORDS[stopId];
    }

    console.warn("No se han podido extraer coords válidas para la parada", stopId);
    return null;
}

// Paradas cercanas
export async function getNearbyStops() {
    if (isInApiCooldown()) {
        throw new Error("Límite de uso de la API EMT. Espera unos minutos.");
    }

    if (!userLocation) {
        throw new Error("No hay ubicación disponible.");
    }
    if (!accessToken) {
        await login();
    }

    const { lat, lon } = userLocation;
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

    if (json.code !== "00") {
        if (isLimitError(json)) {
            activateApiCooldown();
            throw new Error("Límite de uso de la API EMT. Espera unos minutos.");
        }
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

// ... y aquí pondrías fetchStopCoords, getNearbyStops, etc.
// usando STOP_COORDS, STOP_LINES, userLocation igual que ahora
