// map.js — pestaña Mapa con Leaflet (cargado vía CDN, global window.L)

import {
    FAVORITES,
    STOP_COORDS,
    nearbyStopsCache
} from "./state.js";

// userLocation no se importa directamente porque cambia con el tiempo y el
// import quedaría congelado. En su lugar lo leemos desde window via un getter
// que main.js setea. Más simple: leer state.userLocation via re-import dinámico
// es complejo; uso un acceso indirecto.
import * as state from "./state.js";

const MADRID_CENTER = [40.4168, -3.7038];

let mapInstance = null;
let markerLayer = null;
let userMarker = null;
let initialized = false;

function makeStopIcon(kind, symbol = "") {
    return window.L.divIcon({
        className: "stop-marker",
        html: `<div class="stop-marker-inner stop-marker-${kind}">${symbol}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14]
    });
}

function popupHtmlFor(stopId, kind, name) {
    const kindLabel = kind === "fav" ? "Favorita" : "Cercana";
    const safeName = name || `Parada ${stopId}`;
    return `
        <div class="map-popup">
            <div class="map-popup-name"></div>
            <div class="map-popup-meta">${kindLabel} · #${stopId}</div>
            <button type="button" class="map-popup-link"
                    data-stop-id="${stopId}" data-kind="${kind}">
                Ver llegadas →
            </button>
        </div>
    `.replace('<div class="map-popup-name"></div>',
              `<div class="map-popup-name">${escapeHtml(safeName)}</div>`);
}

function escapeHtml(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function switchToTabAndOpenAccordion(stopId, kind) {
    // fav → pestaña Favoritas (0); cualquier otra (cercana) → Cerca de mí (1)
    const tabIndex = kind === "fav" ? 0 : 1;
    const tab = document.querySelector(`.tab-btn[data-index="${tabIndex}"]`);
    if (tab) tab.click();

    // El cambio de pestaña es síncrono, el scroll es seguro tras un frame.
    requestAnimationFrame(() => {
        const article = document.querySelector(
            `.accordion-item[data-stop-id="${stopId}"]`
        );
        if (!article) return;
        if (!article.classList.contains("open")) {
            article.querySelector(".accordion-header")?.click();
        }
        article.scrollIntoView({ behavior: "smooth", block: "center" });
    });
}

export function ensureMapInitialized() {
    if (!window.L) {
        console.warn("Leaflet aún no cargado, reintentando…");
        setTimeout(ensureMapInitialized, 200);
        return;
    }

    if (!initialized) {
        const container = document.getElementById("map");
        if (!container) return;

        const center = state.userLocation
            ? [state.userLocation.lat, state.userLocation.lon]
            : MADRID_CENTER;

        mapInstance = window.L.map(container, {
            zoomControl: true,
            attributionControl: true
        }).setView(center, 14);

        window.L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                maxZoom: 19
            }
        ).addTo(mapInstance);

        markerLayer = window.L.layerGroup().addTo(mapInstance);

        mapInstance.on("popupopen", (e) => {
            const node = e.popup.getElement();
            const btn = node && node.querySelector(".map-popup-link");
            if (!btn) return;
            btn.addEventListener("click", () => {
                const id = parseInt(btn.dataset.stopId, 10);
                if (Number.isFinite(id)) {
                    switchToTabAndOpenAccordion(id, btn.dataset.kind);
                    mapInstance.closePopup();
                }
            }, { once: true });
        });

        initialized = true;
    }

    // Leaflet necesita invalidateSize cuando el contenedor pasa de oculto a
    // visible (cambio de tab). Sin esto se ve gris hasta que redimensionas.
    mapInstance.invalidateSize();
    refreshMapMarkers();
}

export function refreshMapMarkers() {
    if (!initialized || !mapInstance || !markerLayer) return;

    markerLayer.clearLayers();

    const placed = new Set();
    const bounds = [];

    // Favoritas
    FAVORITES.forEach(fav => {
        const coords = STOP_COORDS[fav.id];
        if (!coords) return;
        const m = window.L.marker([coords.lat, coords.lon], {
            icon: makeStopIcon("fav", "★"),
            title: fav.label || `Parada ${fav.id}`
        });
        m.bindPopup(popupHtmlFor(fav.id, "fav", fav.label));
        m.addTo(markerLayer);
        placed.add(fav.id);
        bounds.push([coords.lat, coords.lon]);
    });

    // Cercanas (excluyendo las ya pintadas)
    (nearbyStopsCache || []).forEach(s => {
        const id = s.stopId ?? s.IdStop ?? s.idStop ?? s.id ?? s.stopNum;
        if (id == null) return;
        const idNum = parseInt(id, 10);
        if (!Number.isFinite(idNum) || placed.has(idNum)) return;
        const coords = STOP_COORDS[idNum];
        if (!coords) return;
        const name = s.name ?? s.stopName ?? s.StopName ?? `Parada ${idNum}`;
        const m = window.L.marker([coords.lat, coords.lon], {
            icon: makeStopIcon("near"),
            title: name
        });
        m.bindPopup(popupHtmlFor(idNum, "near", name));
        m.addTo(markerLayer);
        placed.add(idNum);
        bounds.push([coords.lat, coords.lon]);
    });

    // Marcador usuario
    if (userMarker) {
        userMarker.remove();
        userMarker = null;
    }
    if (state.userLocation) {
        userMarker = window.L.circleMarker(
            [state.userLocation.lat, state.userLocation.lon],
            {
                radius: 8,
                color: "#ffffff",
                weight: 2,
                fillColor: "#ef4444",
                fillOpacity: 0.9
            }
        ).bindPopup("Tu ubicación").addTo(mapInstance);
        bounds.push([state.userLocation.lat, state.userLocation.lon]);
    }
}
