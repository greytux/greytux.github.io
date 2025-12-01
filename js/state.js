// state.js

// URLs base de la API
export const BASE_URL_V2 = "https://openapi.emtmadrid.es/v2";
export const BASE_URL_V1 = "https://openapi.emtmadrid.es/v1";

// Paradas favoritas / fijas + las dinámicas que vayamos añadiendo
export const STOPS = [
    { id: 3224, label: "Herrera Oria - Labastida (TRABAJO) - Parada 3224" },
    {
        id: 2677,
        label: "Fuente de la Carra hacia el centro - Parada 2677",
        filterLines: ["66", "137"]
    }
];

// Coordenadas y líneas de cada parada
export const STOP_COORDS = {};
export const STOP_LINES = {};

// Cache de paradas cercanas
export let nearbyStopsCache = [];
export function setNearbyStopsCache(val) {
    nearbyStopsCache = Array.isArray(val) ? val : [];
}

// Ubicación del usuario
export let userLocation = null;
export function setUserLocation(loc) {
    userLocation = loc;
}

// Filtro por línea (paradas cercanas)
export let nearbyLineFilter = "";
export function setNearbyLineFilter(line) {
    nearbyLineFilter = line || "";
}

// Cooldown de la API EMT
export const API_COOLDOWN_MINUTES = 5;
export let apiCooldownUntil = 0;

export function isApiInCooldown() {
    return Date.now() < apiCooldownUntil;
}

export function activateApiCooldown() {
    apiCooldownUntil = Date.now() + API_COOLDOWN_MINUTES * 60 * 1000;
}
