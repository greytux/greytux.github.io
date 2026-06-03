// state.js
// Estado global simple compartido entre módulos
export const BASE_URL_V2 = "https://openapi.emtmadrid.es/v2";
export const BASE_URL_V1 = "https://openapi.emtmadrid.es/v1";

// Favoritas por defecto si no hay nada en localStorage
const FAVORITES_STORAGE_KEY = "greytux:favorites:v1";
const DEFAULT_FAVORITES = [
    { id: 3224, label: "Herrera Oria - Labastida - Parada 3224" },
    { id: 2677, label: "Fuente de la Carra - Parada 2677" },
    { id: 93, label: "La Vaguada - Parada 93" }
];

function sanitizeFavorite(s) {
    if (!s || !Number.isFinite(s.id)) return null;
    const clean = { id: s.id };
    if (typeof s.label === "string" && s.label.trim()) {
        clean.label = s.label.trim();
    }
    if (Array.isArray(s.filterLines)) {
        const lines = s.filterLines
            .map(l => String(l).trim())
            .filter(Boolean);
        if (lines.length) clean.filterLines = lines;
    }
    if (
        s.coords &&
        Number.isFinite(parseFloat(s.coords.lat)) &&
        Number.isFinite(parseFloat(s.coords.lon))
    ) {
        clean.coords = {
            lat: parseFloat(s.coords.lat),
            lon: parseFloat(s.coords.lon)
        };
    }
    return clean;
}

function loadFavoritesFromStorage() {
    try {
        const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
        if (!raw) return DEFAULT_FAVORITES.map(s => ({ ...s }));
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return DEFAULT_FAVORITES.map(s => ({ ...s }));
        const cleaned = parsed.map(sanitizeFavorite).filter(Boolean);
        return cleaned;
    } catch {
        return DEFAULT_FAVORITES.map(s => ({ ...s }));
    }
}

// Favoritas persistidas (las que viven en la pestaña "Favoritas")
export const FAVORITES = loadFavoritesFromStorage();

// "Mis paradas" se ha unificado con Favoritas. Migración única: si quedan
// paradas guardadas con el esquema antiguo, las incorporamos a favoritas y
// borramos la clave vieja para no perder lo que el usuario tuviera ahí.
(function migrateLegacyDynamicStops() {
    const LEGACY_KEY = "greytux:dynamic-stops:v1";
    try {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            let changed = false;
            parsed.forEach(s => {
                const clean = sanitizeFavorite(s);
                if (clean && !FAVORITES.some(f => f.id === clean.id)) {
                    FAVORITES.push(clean);
                    changed = true;
                }
            });
            if (changed) persistFavorites();
        }
        localStorage.removeItem(LEGACY_KEY);
    } catch {
        /* arranque resiliente: si la migración falla, seguimos */
    }
})();

// Lista usada para el polling. Se mantiene como referencia estable para que
// los módulos que importan STOPS sigan funcionando.
export const STOPS = [];

function syncStops() {
    STOPS.length = 0;
    STOPS.push(...FAVORITES);
}
syncStops();

function persistFavorites() {
    try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(FAVORITES));
    } catch (e) {
        console.warn("No se pudo guardar favoritas en localStorage", e);
    }
}

export function isFavorite(id) {
    return FAVORITES.some(s => s.id === id);
}

export function addFavorite(stop) {
    const clean = sanitizeFavorite(stop);
    if (!clean) return false;
    if (FAVORITES.some(s => s.id === clean.id)) return false;
    FAVORITES.push(clean);
    persistFavorites();
    syncStops();
    return true;
}

export function removeFavorite(id) {
    const i = FAVORITES.findIndex(s => s.id === id);
    if (i === -1) return false;
    FAVORITES.splice(i, 1);
    persistFavorites();
    syncStops();
    return true;
}

export function moveFavorite(id, direction) {
    const i = FAVORITES.findIndex(s => s.id === id);
    if (i === -1) return false;
    const j = i + direction;
    if (j < 0 || j >= FAVORITES.length) return false;
    [FAVORITES[i], FAVORITES[j]] = [FAVORITES[j], FAVORITES[i]];
    persistFavorites();
    syncStops();
    return true;
}

export function setFavoriteCoords(id, lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    const fav = FAVORITES.find(s => s.id === id);
    if (!fav) return false;
    fav.coords = { lat, lon };
    STOP_COORDS[id] = { lat, lon };
    persistFavorites();
    return true;
}

// Coordenadas y líneas por parada
export const STOP_COORDS = {};
export const STOP_LINES  = {};

// Hidratar el cache con coordenadas manuales persistidas en favoritas.
// Hacemos esto al cargar el módulo para que cualquier consumidor (renderStop,
// map.js, etc.) ya las tenga disponibles sin esperar a una llamada a la API.
FAVORITES.forEach(f => {
    if (
        f.coords &&
        Number.isFinite(f.coords.lat) &&
        Number.isFinite(f.coords.lon)
    ) {
        STOP_COORDS[f.id] = { lat: f.coords.lat, lon: f.coords.lon };
    }
});

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

// Filtro actual de línea para favoritas
export let favoritesLineFilter = "";
export function setFavoritesLineFilter(line) {
    favoritesLineFilter = line || "";
}

// ---- Alarmas (avísame cuando línea X esté a Y min en parada Z) ----
const ALARMS_STORAGE_KEY = "greytux:alarms:v1";

function sanitizeAlarm(a) {
    if (!a) return null;
    const stopId = Number(a.stopId);
    const threshold = Number(a.threshold);
    const line = a.line != null ? String(a.line).trim().replace(/^0+/, "") : "";
    if (!Number.isFinite(stopId) || !line || !Number.isFinite(threshold) || threshold < 0) {
        return null;
    }
    const id = typeof a.id === "string" && a.id ? a.id : null;
    return { id, stopId, line, threshold };
}

function loadAlarmsFromStorage() {
    try {
        const raw = localStorage.getItem(ALARMS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map(sanitizeAlarm)
            .filter(Boolean)
            .map(a => ({ ...a, id: a.id || newAlarmId() }));
    } catch {
        return [];
    }
}

function newAlarmId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const ALARMS = loadAlarmsFromStorage();

function persistAlarms() {
    try {
        localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(ALARMS));
    } catch (e) {
        console.warn("No se pudo guardar alarmas en localStorage", e);
    }
}

export function addAlarm(input) {
    const clean = sanitizeAlarm(input);
    if (!clean) return null;
    if (ALARMS.some(a =>
        a.stopId === clean.stopId &&
        a.line === clean.line &&
        a.threshold === clean.threshold
    )) {
        return null;
    }
    clean.id = newAlarmId();
    ALARMS.push(clean);
    persistAlarms();
    return clean;
}

export function removeAlarm(id) {
    const i = ALARMS.findIndex(a => a.id === id);
    if (i === -1) return false;
    ALARMS.splice(i, 1);
    persistAlarms();
    return true;
}

export function getAlarmsForStop(stopId) {
    return ALARMS.filter(a => a.stopId === stopId);
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
