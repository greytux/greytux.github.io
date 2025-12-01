// state.js
export const BASE_URL_V2 = "https://openapi.emtmadrid.es/v2";
export const BASE_URL_V1 = "https://openapi.emtmadrid.es/v1";

export const STOP_COORDS = {};
export const STOP_LINES = {};

// Cache de paradas cercanas
export let nearbyStopsCache = [];
export function setNearbyStopsCache(val) {
    nearbyStopsCache = val;
}

// Ubicación del usuario
export let userLocation = null;
export function setUserLocation(loc) {
    userLocation = loc;
}

// Filtro por línea (paradas cercanas)
export let nearbyLineFilter = "";
export function setNearbyLineFilter(line) {
    nearbyLineFilter = line;
}

// Cooldown API
export const API_COOLDOWN_MINUTES = 5;
export let apiCooldownUntil = 0;

export function isApiInCooldown() {
    return Date.now() < apiCooldownUntil;
}

export function activateApiCooldown() {
    apiCooldownUntil = Date.now() + API_COOLDOWN_MINUTES * 60 * 1000;
}
