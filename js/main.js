import {
    STOPS,
    setUserLocation,
    nearbyStopsCache,
    setNearbyStopsCache,
    isApiInCooldown,
    setNearbyLineFilter,
    favoritesLineFilter,
    setFavoritesLineFilter
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
    renderFavorites,
    handleAddFavorite,
    applyFavoritesFilter
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

const addFavoriteForm = document.getElementById("add-favorite-form");
const favIdInput      = document.getElementById("fav-id-input");
const favLinesInput   = document.getElementById("fav-lines-input");

const nearbyStatusEl  = document.getElementById("nearby-status");
const nearbyLineInput = document.getElementById("nearby-line-input");
const nearbyClearBtn  = document.getElementById("nearby-clear");
const nearbyMsgEl     = document.getElementById("nearby-filter-message");

const favLineInput    = document.getElementById("fav-line-input");

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

    // 3) Refrescar favoritas. Normalmente solo las que tienen el acordeón
    //    abierto (las cerradas se refrescan al abrirlas). Pero si hay un filtro
    //    por línea activo, refrescamos todas para poder decidir cuáles tienen
    //    bus de esa línea y ocultar el resto.
    const favFilter = favoritesLineFilter;
    const favsToRefresh = favFilter
        ? STOPS
        : STOPS.filter(s => isStopAccordionOpen(s.id));
    await Promise.all(
        favsToRefresh.map(stop =>
            refreshStop(favFilter ? { ...stop, filterLines: [favFilter] } : stop)
        )
    );
    applyFavoritesFilter();

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
initSlider();                           // Tabs

// Procesar intents desde URL (?parada=NNNN o ?atajo=casa|trabajo)
consumeUrlIntent({ toast });

// Inicializar mapa la primera vez que se active su pestaña (lazy)
const mapTabBtn = document.querySelector('.tab-btn[data-index="2"]');
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

// Filtro "Favoritas por línea" — en vivo (con debounce para no refrescar por tecla)
if (favLineInput) {
    let favFilterTimer = null;
    favLineInput.addEventListener("input", () => {
        setFavoritesLineFilter(normalizeLine(favLineInput.value.trim()));
        applyFavoritesFilter();              // respuesta instantánea con lo ya conocido
        clearTimeout(favFilterTimer);
        favFilterTimer = setTimeout(() => refreshAll(), 500); // refina pidiendo llegadas
    });
}

// Filtro "Paradas cercanas por línea" — en vivo (con debounce)
if (nearbyLineInput) {
    let nearbyFilterTimer = null;
    nearbyLineInput.addEventListener("input", () => {
        setNearbyLineFilter(normalizeLine(nearbyLineInput.value.trim()));
        if (nearbyMsgEl) nearbyMsgEl.textContent = "";
        clearTimeout(nearbyFilterTimer);
        nearbyFilterTimer = setTimeout(() => {
            renderNearbyStops(nearbyStopsCache);
        }, 400);
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

// Registro del service worker (PWA) + aviso de versión nueva
if ("serviceWorker" in navigator) {
    // Cuando el SW en espera toma el control, recargamos una sola vez para
    // que la página corra ya con el código nuevo.
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
    });

    const notifyUpdate = (worker) => {
        if (!worker) return;
        toast("Nueva versión disponible. Toca para actualizar.", {
            type: "info",
            sticky: true,
            onClick: () => worker.postMessage({ type: "SKIP_WAITING" })
        });
    };

    window.addEventListener("load", async () => {
        try {
            const reg = await navigator.serviceWorker.register("./sw.js");

            // Si al registrar ya hay uno esperando y la página está controlada
            // por un SW activo, es que hay versión nueva lista.
            if (reg.waiting && navigator.serviceWorker.controller) {
                notifyUpdate(reg.waiting);
            }

            reg.addEventListener("updatefound", () => {
                const nw = reg.installing;
                if (!nw) return;
                nw.addEventListener("statechange", () => {
                    if (nw.state === "installed" && navigator.serviceWorker.controller) {
                        notifyUpdate(nw);
                    }
                });
            });
        } catch (err) {
            console.warn("SW no registrado:", err);
        }
    });
}
