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
    filterMyStopsByLine
} from "./uiStops.js";

import { initSlider } from "./slider.js";

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

    // 3) Refrescar paradas favoritas
    await Promise.all(STOPS.map(stop => refreshStop(stop)));

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
}

// ---- Listeners básicos ----
setupAccordionListeners();   // Acordeones estáticos de favoritas
initSlider();                // Tabs + swipe

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

// Formulario "Mis paradas" (añadir parada)
if (addStopForm && stopIdInput) {
    addStopForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const raw = stopIdInput.value.trim();
        if (!raw) return;

        const stopId = parseInt(raw, 10);
        if (Number.isNaN(stopId) || stopId <= 0) {
            alert("Introduce un número de parada válido.");
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

// Lanzar la primera actualización y el intervalo
refreshAll();
setInterval(refreshAll, 15000);
