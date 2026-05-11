// coordPicker.js — modal con mini-mapa Leaflet para fijar manualmente
// la ubicación de una parada cuya geometría EMT no expone (p.ej. 2677).

import * as state from "./state.js";

const MADRID_CENTER = [40.4168, -3.7038];

let activeModal = null;

export function openCoordPicker({ stopId, stopName }) {
    return new Promise(resolve => {
        if (activeModal) return resolve(null);
        if (!window.L) {
            console.warn("Leaflet no cargado todavía");
            return resolve(null);
        }

        const overlay = document.createElement("div");
        overlay.className = "coord-picker-overlay";
        overlay.innerHTML = `
            <div class="coord-picker-modal" role="dialog" aria-modal="true" aria-labelledby="coord-picker-title">
                <div class="coord-picker-header">
                    <div class="coord-picker-title" id="coord-picker-title"></div>
                    <button type="button" class="coord-picker-close" aria-label="Cerrar">✕</button>
                </div>
                <div class="coord-picker-help">
                    Pulsa en el mapa donde está la parada. Puedes arrastrar el marcador para ajustar.
                </div>
                <div class="coord-picker-map" id="coord-picker-map"></div>
                <div class="coord-picker-coords">Sin posición seleccionada todavía.</div>
                <div class="coord-picker-actions">
                    <button type="button" class="confirm-btn confirm-cancel">Cancelar</button>
                    <button type="button" class="confirm-btn confirm-ok" disabled>Guardar</button>
                </div>
            </div>
        `;
        overlay.querySelector(".coord-picker-title").textContent =
            `Fijar ubicación de ${stopName || `parada ${stopId}`}`;

        document.body.appendChild(overlay);
        activeModal = overlay;

        const okBtn = overlay.querySelector(".confirm-ok");
        const cancelBtn = overlay.querySelector(".confirm-cancel");
        const closeBtn = overlay.querySelector(".coord-picker-close");
        const coordsTxt = overlay.querySelector(".coord-picker-coords");
        const mapEl = overlay.querySelector("#coord-picker-map");

        let pickerMap = null;
        let marker = null;

        function setCoords(lat, lon) {
            coordsTxt.textContent =
                `📍 ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
            okBtn.disabled = false;
        }

        function placeOrMoveMarker(lat, lon) {
            if (marker) {
                marker.setLatLng([lat, lon]);
            } else {
                marker = window.L.marker([lat, lon], { draggable: true })
                    .addTo(pickerMap);
                marker.on("dragend", () => {
                    const ll = marker.getLatLng();
                    setCoords(ll.lat, ll.lng);
                });
            }
            setCoords(lat, lon);
        }

        function close(result) {
            document.removeEventListener("keydown", onKey);
            if (pickerMap) {
                pickerMap.remove();
                pickerMap = null;
            }
            marker = null;
            overlay.classList.remove("coord-picker-visible");
            setTimeout(() => {
                overlay.remove();
                activeModal = null;
                resolve(result);
            }, 150);
        }

        function onKey(e) {
            if (e.key === "Escape") close(null);
        }

        cancelBtn.addEventListener("click", () => close(null));
        closeBtn.addEventListener("click", () => close(null));
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) close(null);
        });
        document.addEventListener("keydown", onKey);

        okBtn.addEventListener("click", () => {
            if (!marker) return close(null);
            const ll = marker.getLatLng();
            close({ lat: ll.lat, lon: ll.lng });
        });

        requestAnimationFrame(() => {
            overlay.classList.add("coord-picker-visible");

            // Inicializar mapa (centrado en coords existentes > ubicación usuario > Madrid)
            const existing = state.STOP_COORDS[stopId];
            const start = existing
                ? [existing.lat, existing.lon]
                : state.userLocation
                    ? [state.userLocation.lat, state.userLocation.lon]
                    : MADRID_CENTER;

            pickerMap = window.L.map(mapEl).setView(start, existing ? 17 : 14);
            window.L.tileLayer(
                "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                {
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                    maxZoom: 19
                }
            ).addTo(pickerMap);

            if (existing) {
                placeOrMoveMarker(existing.lat, existing.lon);
            }

            pickerMap.on("click", (e) => {
                placeOrMoveMarker(e.latlng.lat, e.latlng.lng);
            });

            // Por si el contenedor estaba con animación
            setTimeout(() => pickerMap.invalidateSize(), 160);
        });
    });
}
