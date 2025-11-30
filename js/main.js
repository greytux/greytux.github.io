// js/main.js
import {
    STOPS,
    setUserLocation,
    setNearbyStopsCache,
    nearbyStopsCache
} from "./state.js";

import {
    getArrivals,
    fetchStopCoords,
    getNearbyStops,
    isInApiCooldown
} from "./apiEmt.js";

import {
    renderNearbyStops,
    createDynamicStopAccordion,
    filterMyStopsByLine
} from "./uiStops.js";

import { initSlider } from "./slider.js";

const globalStatusEl = document.getElementById("last-update-global");
const refreshBtn = document.getElementById("refresh-now");
const addStopForm = document.getElementById("add-stop-form");
const stopIdInput = document.getElementById("stop-id-input");
const myLineInput = document.getElementById("my-line-input");
const nearbyStatusEl = document.getElementById("nearby-status");

// Inicializar slider
const slider = initSlider();

// Geolocalización básica aquí (o en un helper aparte)
function updateUserLocation() {
    return new Promise((resolve) => {
        if (!("geolocation" in navigator)) {
            if (nearbyStatusEl) {
                nearbyStatusEl.textContent = "Geolocalización no disponible.";
            }
            return resolve(false);
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setUserLocation({
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude
                });
                resolve(true);
            },
            () => resolve(false),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
    });
}

async function refreshNearbyStopsWrapper() {
    if (isInApiCooldown()) {
        nearbyStatusEl.textContent =
            "Has alcanzado el límite de uso de la API EMT. Inténtalo luego.";
        renderNearbyStops([]);
        return;
    }
    if (!nearbyStatusEl) return;
    nearbyStatusEl.textContent = "Buscando paradas cercanas…";
    try {
        const stops = await getNearbyStops();
        setNearbyStopsCache(stops);
        await renderNearbyStops(stops);
        nearbyStatusEl.textContent = "Mostrando paradas cercanas.";
    } catch (err) {
        console.error(err);
        nearbyStatusEl.textContent = "No se han podido cargar las paradas cercanas.";
        renderNearbyStops([]);
    }
}

async function refreshAll() {
    if (globalStatusEl) {
        globalStatusEl.textContent = "Actualizando todas las paradas…";
    }

    await updateUserLocation();

    await Promise.all(
        STOPS.map(s => fetchStopCoords(s.id).catch(() => null))
    );

    await Promise.all(
        STOPS.map(stop =>
            getArrivals(stop.id)
                .then(arrivals => renderStop(stop, arrivals))
                .catch(err => console.error(err))
        )
    );

    // Solo refrescar cercanas si estamos en pestaña "Cerca de mí"
    if (slider.getCurrentIndex() === 2) {
        await refreshNearbyStopsWrapper();
    }

    if (globalStatusEl) {
        globalStatusEl.textContent =
            "Última actualización: " + new Date().toLocaleTimeString("es-ES");
    }
}

// Listeners
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
        await createDynamicStopAccordion(stopId);
        stopIdInput.value = "";
    });
}

if (myLineInput) {
    myLineInput.addEventListener("input", () => {
        filterMyStopsByLine(myLineInput.value.trim());
    });
}

if (nearbyApplyBtn && nearbyLineInput) {
    nearbyApplyBtn.addEventListener("click", () => {
        const raw = nearbyLineInput.value.trim();

        if (!raw) {
            nearbyLineFilter = "";
            if (nearbyFilterMsgEl) nearbyFilterMsgEl.textContent = "";
            renderNearbyStops(nearbyStopsCache);
            return;
        }

        nearbyLineFilter = normalizeLine(raw);

        renderNearbyStops(nearbyStopsCache).then(() => {
            // Comprobar si alguna parada (cargada) tiene buses
            let anyMatch = false;
            document.querySelectorAll("#nearby-accordion .bus-list").forEach(list => {
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
        nearbyLineFilter = "";
        if (nearbyFilterMsgEl) nearbyFilterMsgEl.textContent = "";
        renderNearbyStops(nearbyStopsCache);
    });
}

// Init
setupAccordion();
refreshAll();
setInterval(refreshAll, 60000);
