// state.js
// Estado global simple compartido entre módulos
export const BASE_URL_V2 = "https://openapi.emtmadrid.es/v2";
export const BASE_URL_V1 = "https://openapi.emtmadrid.es/v1";

// Paradas favoritas + dinámicas
export const STOPS = [
    { id: 3224, label: "Herrera Oria - Labastida (TRABAJO) - Parada 3224" },
    { id: 2677, label: "Fuente de la Carra hacia el centro - Parada 2677", filterLines: ["66", "137"] }
];

// Coordenadas y líneas por parada
export const STOP_COORDS = {};
export const STOP_LINES  = {};

// Ubicación usuario
export let userLocation = null;
export function setUserLocation(loc) {
    userLocation = loc;
}

// Cache paradas cercanas (respuesta cruda de EMT)
export let nearbyStopsCache = [];
export function setNearbyStopsCache(stops) {
    nearbyStopsCache = Array.isArray(stops) ? stops : [];
}

// Filtro actual de línea para paradas cercanas
export let nearbyLineFilter = "";
export function setNearbyLineFilter(line) {
    nearbyLineFilter = line || "";
}

// Cooldown API EMT
export const API_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos
let apiCooldownUntil = 0;

export function activateApiCooldown() {
    apiCooldownUntil = Date.now() + API_COOLDOWN_MS;
    console.warn("API cooldown activado hasta", new Date(apiCooldownUntil).toISOString());
}

export function isApiInCooldown() {
    return Date.now() < apiCooldownUntil;
}
