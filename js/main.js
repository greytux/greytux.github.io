// main.js
import {
    STOPS,
    userLocation,
    setUserLocation,
    nearbyStopsCache,
    setNearbyStopsCache,
    setNearbyLineFilter,
} from "./state.js";

import {
    isInApiCooldown,
    getNearbyStops,
    fetchStopCoords,
} from "./apiEmt.js";

import {
    refreshStop,            // refresca una parada (llama a getArrivals + renderStop + status)
    renderNearbyStops,      // pinta las paradas cercanas (usa nearbyLineFilter internamente)
    createDynamicStopAccordion,
    filterMyStopsByLine,
    setupAccordionListeners // engancha los click de los acordeones existentes
} from "./uiStops.js";

import { initSlider } from "./slider.js";

document.addEventListener("DOMContentLoaded", () => {
    // --- Referencias al DOM ---
    const globalStatusEl   = document.getElementById("last-update-global");
    const refreshBtn       = document.getElementById("refresh-now");

    const addStopForm      = document.getElementById("add-stop-form");
    const stopIdInput      = document.getElementById("stop-id-input");
    const myLineInput      = document.getElementById("my-line-input");

    const nearbyStatusEl   = document.getElementById("nearby-status");
    const nearbyLineInput  = document.getElementById("nearby-line-input");
    const nearbyApplyBtn   = document.getElementById("nearby-apply");
    const nearbyClearBtn   = document.getElementById("nearby-clear");
    const nearbyFilterMsgEl = document.getElementById("nearby-filter-msg");

    // --- Slider (tabs + swipe) ---
    const slider = initSlider(); // { setSlide, getCurrentIndex }

    // --- Helpers ---

    function normalizeLine(l) {
        if (!l) return "";
        return String(l).trim().replace(/^0+/, "");
    }

    // Geolocalización básica
    function updateUserLocation() {
        return new Promise((resolve) => {
            if (!("geolocation" in navigator)) {
                console.warn("Geolocalización no disponible en este navegador.");
                if (nearbyStatusEl && !userLocation) {
                    nearbyStatusEl.textContent =
                        "Geolocalización no disponible en este dispositivo.";
                }
                return resolve(false);
            }

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    setUserLocation({
                        lat: pos.coords.latitude,
                        lon: pos.coords.longitude,
                    });
                    console.log("Ubicación del usuario (refresco):", userLocation);
                    resolve(true);
                },
                (err) => {
                    console.warn("No se pudo obtener la ubicación:", err.message);
                    if (nearbyStatusEl && !userLocation) {
                        nearbyStatusEl.textContent =
                            "No se ha podido obtener tu ubicación. Revisa permisos de geolocalización.";
                    }
                    resolve(false);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 30000,
                }
            );
        });
    }

    // Refrescar paradas cercanas (wrapper)
    async function refreshNearbyStopsWrapper() {
        if (!nearbyStatusEl) return;

        if (!userLocation) {
            nearbyStatusEl.textContent =
                "Activa la geolocalización del navegador para ver paradas cercanas.";
            // Limpia acordeones cercanos
            await renderNearbyStops([]);
            return;
        }

        if (isInApiCooldown()) {
            nearbyStatusEl.textContent =
                "Has alcanzado el límite de uso de la API EMT. Espera unos minutos.";
            await renderNearbyStops([]); // no mostramos nada para no confundir
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
            nearbyStatusEl.textContent =
                "No se han podido cargar las paradas cercanas.";
            await renderNearbyStops([]);
        }
    }

    // Refresco global
    async function refreshAll() {
        if (globalStatusEl) {
            globalStatusEl.textContent = "Actualizando todas las paradas…";
        }

        // Si estamos en cooldown, no pegamos a la API
        if (isInApiCooldown()) {
            console.warn("API en cooldown, no se harán llamadas nuevas a EMT.");
            if (globalStatusEl) {
                globalStatusEl.textContent =
                    "Has alcanzado el límite de uso de la API EMT. Espera unos minutos.";
            }

            // Marcamos estados de las paradas favoritas
            STOPS.forEach(stop => {
                const statusWrapper = document.getElementById(`status-${stop.id}`);
                const statusText = statusWrapper?.querySelector("span:nth-child(2)");
                if (statusWrapper && statusText) {
                    statusWrapper.classList.add("error");
                    statusText.textContent =
                        "Límite de uso de la API EMT. Espera unos minutos.";
                }
            });

            if (nearbyStatusEl) {
                nearbyStatusEl.textContent =
                    "Límite de uso de la API EMT. No se pueden refrescar paradas cercanas ahora mismo.";
            }

            return;
        }

        // 1) Geolocalización
        await updateUserLocation();

        // 2) Coords de paradas favoritas (3224, 2677, y las que hayas metido en STOPS)
        await Promise.all(
            STOPS.map(s => fetchStopCoords(s.id).catch(() => null))
        );

        // 3) Refrescar paradas favoritas (fijas + dinámicas ya incluidas en STOPS)
        await Promise.all(
            STOPS.map(stop => refreshStop(stop).catch(err => console.error(err)))
        );

        // 4) Refrescar paradas cercanas solo si estamos en la pestaña "Cerca de mí" (index 2)
        if (slider.getCurrentIndex && slider.getCurrentIndex() === 2) {
            await refreshNearbyStopsWrapper();
        }

        if (globalStatusEl) {
            globalStatusEl.textContent =
                "Última actualización: " + new Date().toLocaleTimeString("es-ES");
        }
    }

    // --- Listeners de UI ---

    // Botón refrescar global
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

    // Formulario: añadir parada dinámica
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

    // Filtro "Mis paradas" (slide Mis paradas)
    if (myLineInput) {
        myLineInput.addEventListener("input", () => {
            filterMyStopsByLine(myLineInput.value.trim());
        });
    }

    // Filtro paradas cercanas (Aplicar / Quitar)
    if (nearbyApplyBtn && nearbyLineInput) {
        nearbyApplyBtn.addEventListener("click", () => {
            const raw = nearbyLineInput.value.trim();

            // Sin valor → quitamos filtro y re-renderizamos
            if (!raw) {
                setNearbyLineFilter("");
                if (nearbyFilterMsgEl) nearbyFilterMsgEl.textContent = "";
                renderNearbyStops(nearbyStopsCache);
                return;
            }

            const normalized = normalizeLine(raw);
            setNearbyLineFilter(normalized);

            renderNearbyStops(nearbyStopsCache).then(() => {
                // Comprobar si alguna parada (cargada) tiene buses
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

    // Engancha los clics de los acordeones que ya vienen en el HTML
    setupAccordionListeners();

    // Primera carga
    refreshAll();

    // Auto-refresh cada 60s (puedes dejarlo en 15000 si quieres algo más agresivo)
    setInterval(refreshAll, 60000);
});
