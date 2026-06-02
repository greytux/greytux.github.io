import {
    STOPS,
    setUserLocation,
    nearbyStopsCache,
    setNearbyStopsCache,
    isApiInCooldown,
    setNearbyLineFilter
} from "./state.js";

import {
    updateUserLocation,
    fetchStopCoords,
    getNearbyStops
} from "./apiEmt.js";

import {
    setupAccordionListeners,
    refreshStop,
    renderNearbyStops,
    createDynamicStopAccordion,
    filterMyStopsByLine,
    renderFavorites,
    renderDynamicStops,
    handleAddFavorite
} from "./uiStops.js";

import { initSlider } from "./slider.js";

import { toast } from "./toast.js";

import { hasAnyAlarms, getAlarmedStopIds } from "./alarms.js";

import {
    ensureMapInitialized,
    refreshMapMarkers
} from "./map.js";

import {
    renderShortcutsConfig,
    consumeUrlIntent
} from "./shortcuts.js";

// Util para normalizar número de línea (quita ceros a la izquierda)
function normalizeLine(l) {
    if (l == null) return "";
    return String(l).trim().replace(/^0+/, "");
}

// Referencias DOM globales
const globalStatusEl = document.getElementById("last-update-global");
const refreshBtn      = document.getElementById("refresh-now");

const addStopForm     = document.getElementById("add-stop-form");
const stopIdInput     = document.getElementById("stop-id-input");

const addFavoriteForm = document.getElementById("add-favorite-form");
const favIdInput      = document.getElementById("fav-id-input");
const favLinesInput   = document.getElementById("fav-lines-input");

const nearbyStatusEl  = document.getElementById("nearby-status");
const nearbyLineInput = document.getElementById("nearby-line-input");
const nearbyApplyBtn  = document.getElementById("nearby-apply");
const nearbyClearBtn  = document.getElementById("nearby-clear");
const nearbyMsgEl     = document.getElementById("nearby-filter-message");

const myLineInput     = document.getElementById("my-line-input");

// --- Refresh paradas cercanas (wrapper con texto + cache) ---
async function refreshNearbyStopsWrapper() {
    if (!nearbyStatusEl) return;

    if (isApiInCooldown()) {
        nearbyStatusEl.textContent =
            "Límite de uso de la API EMT. Espera unos minutos.";
        return;
    }

    if (!navigator.geolocation) {
        nearbyStatusEl.textContent =
            "Geolocalización no disponible en este dispositivo.";
        return;
    }

    nearbyStatusEl.textContent = "Buscando paradas cercanas…";

    try {
        const stops = await getNearbyStops();
        setNearbyStopsCache(stops);
        await renderNearbyStops(stops);
        nearbyStatusEl.textContent = "Mostrando las paradas cercanas a tu ubicación.";
    } catch (err) {
        console.error(err);
        if (err.message === "API_COOLDOWN" || err.message === "API_LIMIT_REACHED") {
            nearbyStatusEl.textContent =
                "Límite de uso de la API EMT. Espera unos minutos.";
        } else if (err.message === "NO_LOCATION") {
            nearbyStatusEl.textContent =
                "Activa la geolocalización del navegador para ver paradas cercanas.";
        } else {
            nearbyStatusEl.textContent =
                "No se han podido cargar las paradas cercanas.";
        }
    }
}

function isStopAccordionOpen(stopId) {
    const el = document.querySelector(
        `.accordion-item[data-stop-id="${stopId}"]`
    );
    return !!(el && el.classList.contains("open"));
}

// --- Refresh global ---
async function refreshAll() {
    if (globalStatusEl) {
        globalStatusEl.textContent = "Actualizando todas las paradas…";
    }

    // 1) Ubicación usuario
    try {
        const loc = await updateUserLocation();
        if (loc) {
            setUserLocation(loc);
        }
    } catch (e) {
        console.warn("No se pudo actualizar ubicación", e);
    }

    // 2) Coords de paradas favoritas (solo si la API no está en cooldown)
    if (!isApiInCooldown()) {
        await Promise.all(
            STOPS.map(s => fetchStopCoords(s.id).catch(() => null))
        );
    }

    // 3) Refrescar solo las paradas con acordeón abierto. Las cerradas se
    //    refrescarán en el momento de abrirlas (ver header click handler).
    const openStops = STOPS.filter(s => isStopAccordionOpen(s.id));
    await Promise.all(openStops.map(stop => refreshStop(stop)));

    // 4) Paradas cercanas
    await refreshNearbyStopsWrapper();

    if (globalStatusEl) {
        const now = new Date().toLocaleTimeString("es-ES");
        if (isApiInCooldown()) {
            globalStatusEl.textContent =
                `Última actualización: ${now} · Límite de API, usando últimos datos.`;
        } else {
            globalStatusEl.textContent = `Última actualización: ${now}`;
        }
    }

    // Si el mapa ya está inicializado, refrescar markers tras cambiar datos
    refreshMapMarkers();
}

// ---- Listeners básicos ----
setupAccordionListeners();              // No-op (compat); favoritas dinámicas se montan abajo
renderShortcutsConfig();                // Config Casa/Trabajo en Favoritas
renderFavorites();                      // Pinta favoritas desde localStorage
renderDynamicStops(normalizeLine);      // Pinta Mis paradas desde localStorage
initSlider();                           // Tabs + swipe

// Procesar intents desde URL (?parada=NNNN o ?atajo=casa|trabajo)
consumeUrlIntent({ toast });

// Inicializar mapa la primera vez que se active su pestaña (lazy)
const mapTabBtn = document.querySelector('.tab-btn[data-index="3"]');
if (mapTabBtn) {
    mapTabBtn.addEventListener("click", () => {
        ensureMapInitialized();
    });
}

// Botón refresh global
if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
        refreshBtn.classList.add("refresh-spin");
        try {
            await refreshAll();
        } finally {
            setTimeout(() => refreshBtn.classList.remove("refresh-spin"), 600);
        }
    });
}

// Formulario "Favoritas" (añadir favorita persistida)
if (addFavoriteForm && favIdInput) {
    addFavoriteForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const raw = favIdInput.value.trim();
        if (!raw) return;

        const stopId = parseInt(raw, 10);
        if (Number.isNaN(stopId) || stopId <= 0) {
            toast("Introduce un número de parada válido.", { type: "error" });
            return;
        }

        const linesRaw = favLinesInput ? favLinesInput.value.trim() : "";
        const filterLines = linesRaw
            ? linesRaw.split(",").map(l => normalizeLine(l)).filter(Boolean)
            : null;

        const ok = await handleAddFavorite(stopId, filterLines);
        if (ok) {
            favIdInput.value = "";
            if (favLinesInput) favLinesInput.value = "";
        }
    });
}

// Formulario "Mis paradas" (añadir parada)
if (addStopForm && stopIdInput) {
    addStopForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const raw = stopIdInput.value.trim();
        if (!raw) return;

        const stopId = parseInt(raw, 10);
        if (Number.isNaN(stopId) || stopId <= 0) {
            toast("Introduce un número de parada válido.", { type: "error" });
            return;
        }

        await createDynamicStopAccordion(stopId, normalizeLine);
        stopIdInput.value = "";
    });
}

// Filtro "Mis paradas por línea"
if (myLineInput) {
    myLineInput.addEventListener("input", () => {
        filterMyStopsByLine(myLineInput.value.trim(), normalizeLine);
    });
}

// Filtro "Paradas cercanas por línea" (aplicar / quitar)
if (nearbyApplyBtn && nearbyLineInput) {
    nearbyApplyBtn.addEventListener("click", () => {
        const raw = nearbyLineInput.value.trim();

        if (!raw) {
            setNearbyLineFilter("");
            if (nearbyMsgEl) nearbyMsgEl.textContent = "";
            renderNearbyStops(nearbyStopsCache);
            return;
        }

        setNearbyLineFilter(normalizeLine(raw));

        renderNearbyStops(nearbyStopsCache).then(() => {
            let anyMatch = false;
            document
                .querySelectorAll("#nearby-accordion .bus-list")
                .forEach(list => {
                    if (
                        list.children.length &&
                        !list.children[0].classList.contains("empty")
                    ) {
                        anyMatch = true;
                    }
                });

            if (!anyMatch && nearbyMsgEl) {
                nearbyMsgEl.textContent =
                    "No hay paradas cercanas con buses de esa línea ahora mismo.";
            } else if (nearbyMsgEl) {
                nearbyMsgEl.textContent = "";
            }
        });
    });
}

if (nearbyClearBtn && nearbyLineInput) {
    nearbyClearBtn.addEventListener("click", () => {
        nearbyLineInput.value = "";
        setNearbyLineFilter("");
        if (nearbyMsgEl) nearbyMsgEl.textContent = "";
        renderNearbyStops(nearbyStopsCache);
    });
}

// Polling con setTimeout encadenado: el siguiente tick solo se planifica
// cuando el anterior ha terminado, así un tick lento no solapa con el siguiente.
const REFRESH_MS = 45000;
let refreshTimer = null;
let pollingActive = false;

// Tick "ligero": solo paradas con alarma. Sin geolocalización ni cercanas.
async function refreshAlarmedOnly() {
    const ids = getAlarmedStopIds();
    if (!ids.length) return;
    if (isApiInCooldown()) return;
    await Promise.all(ids.map(id => refreshStop({ id })));
}

// Tick decidido por la visibilidad de la pestaña
async function pollingTick() {
    if (document.visibilityState === "visible") {
        await refreshAll();
    } else if (hasAnyAlarms()) {
        await refreshAlarmedOnly();
    }
}

async function pollingLoop() {
    if (!pollingActive) return;
    try {
        await pollingTick();
    } catch (err) {
        console.warn("pollingTick error", err);
    }
    if (!pollingActive) return;
    refreshTimer = setTimeout(pollingLoop, REFRESH_MS);
}

function startPolling() {
    if (pollingActive) return;
    pollingActive = true;
    refreshTimer = setTimeout(pollingLoop, REFRESH_MS);
}

function stopPolling() {
    pollingActive = false;
    if (refreshTimer != null) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        refreshAll();
        startPolling();
    } else if (!hasAnyAlarms()) {
        stopPolling();
    }
    // Si hay alarmas activas mantenemos el polling también con la pestaña oculta
    // pero solo refresca paradas con alarma (refreshAlarmedOnly).
});

refreshAll();
if (document.visibilityState === "visible") {
    startPolling();
}

// Registro del service worker (PWA)
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("./sw.js")
            .catch(err => console.warn("SW no registrado:", err));
    });
}
