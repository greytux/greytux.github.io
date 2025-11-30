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

// Init
setupAccordion();
refreshAll();
setInterval(refreshAll, 60000);
