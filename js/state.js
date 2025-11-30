// js/state.js
export const BASE_URL_V2 = "https://openapi.emtmadrid.es/v2";
export const BASE_URL_V1 = "https://openapi.emtmadrid.es/v1";

// Investigar TODO
export const EMT_USER = "diegojesus.escudero@gmail.com";
export const EMT_PASS = "Linares251291?";

// Estado de la sesión EMT
export let accessToken = null;
export function setAccessToken(token) {
    accessToken = token;
}

// Cooldown API
export const API_COOLDOWN_MS = 10 * 60 * 1000;
export let apiCooldownUntil = 0;
export function setApiCooldownUntil(ts) {
    apiCooldownUntil = ts;
}

// Paradas favoritas / dinámicas
export const STOPS = [
    { id: 3224, label: "Herrera Oria - Labastida (TRABAJO) - Parada 3224" },
    { id: 2677, label: "Fuente de la Carra hacia el centro - Parada 2677", filterLines: ["66", "137"] }
];

// Coordenadas y líneas
export const STOP_COORDS = {};
export const STOP_LINES = {};

// Geolocalización
export let userLocation = null;
export function setUserLocation(loc) {
    userLocation = loc;
}

// Paradas cercanas cache y filtro
export let nearbyStopsCache = [];
export function setNearbyStopsCache(stops) {
    nearbyStopsCache = stops;
}
export let nearbyLineFilter = "";
export function setNearbyLineFilter(line) {
    nearbyLineFilter = line;
}

if (nearbyApplyBtn && nearbyLineInput) {
    nearbyApplyBtn.addEventListener("click", () => {
        const raw = nearbyLineInput.value.trim();

        if (!raw) {
            setNearbyLineFilter("");                      // 👈 usar setter
            if (nearbyFilterMsgEl) nearbyFilterMsgEl.textContent = "";
            renderNearbyStops(nearbyStopsCache);
            return;
        }

        const normalized = normalizeLine(raw);
        setNearbyLineFilter(normalized);                  // 👈 usar setter

        renderNearbyStops(nearbyStopsCache).then(() => {
            let anyMatch = false;

            document
              .querySelectorAll("#nearby-accordion .bus-list")
              .forEach(list => {
                  if (!list.children.length) return;
                  const first = list.children[0];
                  if (!first.classList.contains("empty")) {
                      anyMatch = true;
                  }
              });

            if (!anyMatch) {
                if (nearbyFilterMsgEl) {
                    nearbyFilterMsgEl.textContent =
                        "No hay paradas cercanas con buses de esa línea ahora mismo (en las paradas cargadas).";
                }
            } else {
                if (nearbyFilterMsgEl) nearbyFilterMsgEl.textContent = "";
            }
        });
    });
}

if (nearbyClearBtn && nearbyLineInput) {
    nearbyClearBtn.addEventListener("click", () => {
        nearbyLineInput.value = "";
        setNearbyLineFilter("");
        if (nearbyFilterMsgEl) nearbyFilterMsgEl.textContent = "";
        renderNearbyStops(nearbyStopsCache);
    });
}
