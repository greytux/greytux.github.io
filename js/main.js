// main.js
import {
    STOPS,
    nearbyStopsCache,
    setNearbyStopsCache,
    nearbyLineFilter,
    setNearbyLineFilter,
    userLocation,
    setUserLocation,
    isApiInCooldown
} from "./state.js";

import {
    login,
    fetchStopCoords,
    getNearbyStops,
    normalizeLinePublic
} from "./apiEmt.js";

import {
    renderStop,
    refreshStop,
    renderNearbyStops,
    createDynamicStopAccordion,
    filterMyStopsByLine,
    setupAccordionListeners,
    updateLocationLink
} from "./uiStops.js";

import { setupSlider } from "./slider.js";

// DOM
const globalStatusEl = document.getElementById("last-update-global");
const nearbyStatusEl = document.getElementById("nearby-status");

// Slider init
const tabs = document.querySelectorAll(".tab-btn");
const sliderEl = document.querySelector(".slider");
const slidesContainer = document.getElementById("slides");

const slider = setupSlider(tabs, sliderEl, slidesContainer);

// Geolocalización…
async function updateUserLocation() {
    return new Promise(resolve => {
        navigator.geolocation.getCurrentPosition(
            pos => {
                setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
                resolve(true);
            },
            () => resolve(false)
        );
    });
}

// Refresco cercano
async function refreshNearbyStopsWrapper() {
    if (!userLocation) return renderNearbyStops([]);

    if (isApiInCooldown()) {
        nearbyStatusEl.textContent = "⚠️ Límite de API alcanzado. Espera unos minutos.";
        return renderNearbyStops([]);
    }

    const stops = await getNearbyStops(userLocation);
    setNearbyStopsCache(stops);
    await renderNearbyStops(stops);
}

// Refresh ALL
async function refreshAll() {
    if (globalStatusEl) globalStatusEl.textContent = "Actualizando…";

    if (isApiInCooldown()) {
        globalStatusEl.textContent = "⏳ API en cooldown. Espera unos minutos.";
        return;
    }

    await updateUserLocation();

    await Promise.all(STOPS.map(s => fetchStopCoords(s.id)));
    STOPS.forEach(s => updateLocationLink(s.id));
    await Promise.all(STOPS.map(s => refreshStop(s)));

    await refreshNearbyStopsWrapper();

    globalStatusEl.textContent = "Última actualización: " + new Date().toLocaleTimeString("es-ES");
}

// Listeners UI
document.getElementById("refresh-now").onclick = refreshAll;

document.getElementById("nearby-apply").onclick = () => {
    const val = document.getElementById("nearby-line-input").value.trim();
    setNearbyLineFilter(normalizeLinePublic(val));
    renderNearbyStops(nearbyStopsCache);
};

document.getElementById("nearby-clear").onclick = () => {
    document.getElementById("nearby-line-input").value = "";
    setNearbyLineFilter("");
    renderNearbyStops(nearbyStopsCache);
};

// Mis paradas filtro
document.getElementById("my-line-input").oninput = e => {
    filterMyStopsByLine(e.target.value.trim(), normalizeLinePublic);
};

// Paradas dinámicas
document.getElementById("add-stop-form").onsubmit = async e => {
    e.preventDefault();
    const raw = document.getElementById("stop-id-input").value.trim();
    const id = parseInt(raw, 10);
    if (!id) return;
    await createDynamicStopAccordion(id, fetchStopCoords, normalizeLinePublic);
    stopIdInput.value = "";
};

// INIT
setupAccordionListeners();
slider.setSlide(0);
refreshAll();
setInterval(refreshAll, 15000);
