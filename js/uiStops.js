import {
    STOPS,
    FAVORITES,
    DYNAMIC_STOPS,
    STOP_COORDS,
    STOP_LINES,
    nearbyLineFilter,
    userLocation,
    addFavorite,
    removeFavorite,
    moveFavorite,
    addDynamicStop,
    removeDynamicStop
} from "./state.js";

import {
    getArrivals,
    fetchStopCoords
} from "./apiEmt.js";

import { toast, confirmDialog } from "./toast.js";

import {
    evaluateAlarmsForStop,
    renderAlarmsForStop
} from "./alarms.js";

// --- Enlace "Ver ubicación" + "Ver ruta andando" ---
function updateLocationLink(stopId) {
    const container = document.getElementById(`location-${stopId}`);
    if (!container) return;

    const coords = STOP_COORDS[stopId];
    if (!coords) {
        container.innerHTML = "";
        return;
    }

    const mapPointUrl = `https://www.google.com/maps?q=${coords.lat},${coords.lon}`;

    let html = `
    <a class="location-link"
       href="${mapPointUrl}"
       target="_blank"
       rel="noopener noreferrer">
       Ver ubicación en mapa
    </a>
  `;

    if (userLocation) {
        const routeUrl =
            `https://www.google.com/maps/dir/?api=1` +
            `&origin=${userLocation.lat},${userLocation.lon}` +
            `&destination=${coords.lat},${coords.lon}` +
            `&travelmode=walking`;

        html += `
      <span style="margin: 0 6px; color: #9ca3af;">·</span>
      <a class="location-link"
         href="${routeUrl}"
         target="_blank"
         rel="noopener noreferrer">
         Ver ruta andando
      </a>
    `;
    } else {
        html += `
      <span style="margin-left: 6px; color: #9ca3af;">
        (activa la geolocalización para ver la ruta andando)
      </span>
    `;
    }

    container.innerHTML = html;
}

// ---- RENDER PARADA INDIVIDUAL ----
export function renderStop(stopConfig, arrivals) {
    const { id, filterLines } = stopConfig;

    // Evaluar alarmas siempre, antes de filtrar por filterLines (la alarma puede
    // ser de una línea distinta a las filtradas en la favorita).
    evaluateAlarmsForStop(id, arrivals);
    renderAlarmsForStop(id);

    // Refrescar el link de ubicación en cada render: si las coords acaban de
    // llegar (p.ej. vía StopInfo de /arrives/ porque /detail/ no las daba),
    // el enlace "Ver ubicación" aparece sin esperar a re-renderizar acordeones.
    updateLocationLink(id);

    const listEl = document.getElementById(`buses-${id}`);
    const statusWrapper = document.getElementById(`status-${id}`);
    const reachEl = document.getElementById(`reach-${id}`);
    const walkEl = document.getElementById(`walk-${id}`);

    if (!listEl || !statusWrapper) return;

    const statusText = statusWrapper.querySelector("span:nth-child(2)");

    if (walkEl) walkEl.textContent = "";
    listEl.innerHTML = "";

    let filtered = arrivals;
    if (filterLines && filterLines.length) {
        filtered = arrivals.filter(a =>
            filterLines.includes(String(a.line).trim())
        );
    }

    let nextBusMinutes = null;
    filtered.forEach(arr => {
        if (arr.estimateArrive != null) {
            const m = Math.round(arr.estimateArrive / 60);
            if (nextBusMinutes == null || m < nextBusMinutes) {
                nextBusMinutes = m;
            }
        }
    });

    if (reachEl) {
        if (nextBusMinutes != null) {
            reachEl.textContent = `Próximo bus en ~${nextBusMinutes} min.`;
        } else {
            reachEl.textContent = "";
        }
    }

    if (!filtered.length) {
        const li = document.createElement("li");
        li.className = "empty";

        if (filterLines && filterLines.length) {
            li.textContent = "No hay buses de esa línea en esta parada ahora mismo.";
            statusWrapper.classList.remove("error");
            if (statusText) statusText.textContent = "Sin buses de la línea filtrada.";
        } else {
            li.textContent = "No hay buses previstos ahora mismo.";
            statusWrapper.classList.remove("error");
            if (statusText) statusText.textContent = "Sin previsiones ahora mismo.";
        }

        listEl.appendChild(li);
        return;
    }

    statusWrapper.classList.remove("error");
    if (statusText) statusText.textContent = "Datos en tiempo real.";

    filtered
        .sort((a, b) => (a.estimateArrive || 0) - (b.estimateArrive || 0))
        .forEach(arr => {
            const li = document.createElement("li");

            const minutes = arr.estimateArrive != null
                ? Math.round(arr.estimateArrive / 60)
                : null;

            let className = "bus-item";
            if (minutes != null) {
                if (minutes < 3) {
                    className += " urgent";
                } else if (minutes <= 10) {
                    className += " soon";
                }
            }
            li.className = className;

            const left = document.createElement("div");
            left.className = "bus-left";

            const lineBadge = document.createElement("div");
            lineBadge.className = "line-badge";
            lineBadge.innerHTML = `<span class="line-text">${arr.line}</span>`;

            const textBlock = document.createElement("div");
            textBlock.className = "bus-text";
            textBlock.innerHTML = `
        <div class="bus-main">${arr.destination || "Destino no disponible"}</div>
        <div class="bus-sub">
          Distancia aprox bus-parada: ${arr.DistanceBus != null ? arr.DistanceBus + " m" : "-"}
        </div>
      `;

            left.appendChild(lineBadge);
            left.appendChild(textBlock);

            const right = document.createElement("div");
            right.className = "bus-right";

            const pill = document.createElement("div");
            pill.className = "pill-minutes";

            if (minutes === 0) {
                pill.textContent = "Llegando";
            } else if (minutes != null) {
                pill.textContent = `${minutes} min`;
            } else {
                pill.textContent = "? min";
            }

            const label = document.createElement("div");
            label.className = "pill-label";
            if (minutes != null) {
                if (minutes <= 2) {
                    label.textContent = "Muy justo";
                } else if (minutes <= 5) {
                    label.textContent = "Justo";
                } else if (minutes <= 10) {
                    label.textContent = "Tienes margen";
                } else {
                    label.textContent = "Tiempo de sobra";
                }
            } else {
                label.textContent = "Sin estimación precisa";
            }

            right.appendChild(pill);
            right.appendChild(label);

            li.appendChild(left);
            li.appendChild(right);
            listEl.appendChild(li);
        });
}

// --- Refrescar una parada individual ---
export async function refreshStop(stopConfig) {
    const statusWrapper = document.getElementById(`status-${stopConfig.id}`);
    const statusText = statusWrapper?.querySelector("span:nth-child(2)");

    if (statusWrapper && statusText) {
        statusWrapper.classList.remove("error");
        statusText.textContent = "Actualizando…";
    }

    try {
        const arrivals = await getArrivals(stopConfig.id);
        renderStop(stopConfig, arrivals);
    } catch (err) {
        console.error(err);
        if (!statusWrapper || !statusText) return;

        statusWrapper.classList.add("error");

        if (err.message === "API_COOLDOWN" || err.message === "API_LIMIT_REACHED") {
            statusText.textContent =
                "Límite de uso de la API EMT. Espera unos minutos.";
        } else {
            statusText.textContent = "Error: " + err.message;
        }
    }
}

// ---- Helper: construir un acordeón de parada ----
function buildStopAccordionElement(stopConfig, opts = {}) {
    const {
        title,
        subtitle,
        open = false,
        actions = null
    } = opts;

    const id = stopConfig.id;
    const article = document.createElement("article");
    article.className = "accordion-item" + (open ? " open" : "");
    article.dataset.stopId = String(id);

    const displayTitle = title ?? `Parada ${id}`;
    const displaySubtitle = subtitle ?? `Parada ${id}`;

    article.innerHTML = `
      <button class="accordion-header" type="button">
        <div class="accordion-header-main">
          <div class="stop-name"></div>
          <div class="stop-subtitle"></div>
        </div>
        <span class="badge">${id}</span>
      </button>
      <div class="accordion-panel">
        <div class="walk-time" id="walk-${id}"></div>
        <div class="reach-time" id="reach-${id}"></div>
        <div id="location-${id}" class="location-link-container"></div>
        <div class="status" id="status-${id}">
          <span class="status-dot"></span>
          <span>Cargando…</span>
        </div>
        <ul class="bus-list" id="buses-${id}"></ul>
        <div class="alarms-section" id="alarms-${id}"></div>
      </div>
    `;

    article.querySelector(".stop-name").textContent = displayTitle;
    article.querySelector(".stop-subtitle").textContent = displaySubtitle;

    const header = article.querySelector(".accordion-header");

    if (actions && actions.length) {
        const actionsEl = document.createElement("div");
        actionsEl.className = "stop-actions";
        actions.forEach(({ icon, title: actTitle, danger, disabled, onClick }) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "stop-action-btn" + (danger ? " danger" : "");
            const label = actTitle || icon || "";
            btn.title = label;
            btn.setAttribute("aria-label", label);
            btn.textContent = icon;
            if (disabled) btn.disabled = true;
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!btn.disabled) onClick();
            });
            actionsEl.appendChild(btn);
        });
        const badge = header.querySelector(".badge");
        header.insertBefore(actionsEl, badge);
    }

    header.addEventListener("click", () => {
        const willOpen = !article.classList.contains("open");
        article.classList.toggle("open");
        // Al abrir un acordeón, refrescar inmediatamente sin esperar al siguiente
        // tick (que ya no refresca acordeones cerrados, así que no hay datos
        // recién traídos cuando lo abres).
        if (willOpen) {
            header.setAttribute("aria-expanded", "true");
            refreshStop(stopConfig).catch(err => console.warn("refreshStop on open failed", err));
        } else {
            header.setAttribute("aria-expanded", "false");
        }
    });

    header.setAttribute("aria-expanded", open ? "true" : "false");

    return article;
}

function favoriteSubtitle(fav) {
    if (fav.filterLines && fav.filterLines.length) {
        const ls = fav.filterLines.join(", ");
        return `Parada ${fav.id} · Líneas ${ls}`;
    }
    return `Parada ${fav.id} · Todas las líneas`;
}

function favoriteTitle(fav) {
    if (fav.label && fav.label.trim()) {
        // Quitar "- Parada NNNN" del label si está presente, para no duplicar
        return fav.label
            .replace(new RegExp(`\\s*[-·]\\s*Parada\\s+${fav.id}\\s*$`, "i"), "")
            .trim();
    }
    return `Parada ${fav.id}`;
}

// ---- RENDER FAVORITAS ----
export async function renderFavorites() {
    const container = document.getElementById("favorites-stops");
    if (!container) return;

    // Recordar qué favoritas estaban abiertas para mantener el estado
    const prevOpen = new Set();
    container.querySelectorAll(".accordion-item.open").forEach(item => {
        if (item.dataset.stopId) prevOpen.add(item.dataset.stopId);
    });

    container.innerHTML = "";

    if (!FAVORITES.length) {
        const div = document.createElement("div");
        div.className = "empty";
        div.textContent = "Sin favoritas todavía. Añade una con el formulario.";
        container.appendChild(div);
        return;
    }

    FAVORITES.forEach((fav, idx) => {
        // Por defecto las favoritas se abren si es la primera carga,
        // o si ya estaban abiertas antes del re-render.
        const wasOpen = prevOpen.size === 0 || prevOpen.has(String(fav.id));

        const article = buildStopAccordionElement(fav, {
            title: favoriteTitle(fav),
            subtitle: favoriteSubtitle(fav),
            open: wasOpen,
            actions: [
                {
                    icon: "↑",
                    title: "Subir",
                    disabled: idx === 0,
                    onClick: () => {
                        moveFavorite(fav.id, -1);
                        renderFavorites().then(refreshFavorites);
                    }
                },
                {
                    icon: "↓",
                    title: "Bajar",
                    disabled: idx === FAVORITES.length - 1,
                    onClick: () => {
                        moveFavorite(fav.id, +1);
                        renderFavorites().then(refreshFavorites);
                    }
                },
                {
                    icon: "✕",
                    title: "Quitar de favoritas",
                    danger: true,
                    onClick: async () => {
                        const ok = await confirmDialog(
                            `¿Quitar la parada ${fav.id} de favoritas?`,
                            { okText: "Quitar", danger: true }
                        );
                        if (!ok) return;
                        removeFavorite(fav.id);
                        await renderFavorites();
                        toast(`Parada ${fav.id} quitada de favoritas.`, { type: "success" });
                    }
                }
            ]
        });

        container.appendChild(article);
        updateLocationLink(fav.id);
        renderAlarmsForStop(fav.id);
    });
}

async function refreshFavorites() {
    await Promise.all(FAVORITES.map(fav => refreshStop(fav)));
}

// --- Añadir favorita desde formulario ---
export async function handleAddFavorite(stopId, filterLines) {
    if (FAVORITES.some(s => s.id === stopId)) {
        toast(`La parada ${stopId} ya está en favoritas.`, { type: "warn" });
        return false;
    }

    let arrivals;
    try {
        arrivals = await getArrivals(stopId);
    } catch (err) {
        console.error(err);
        toast(
            `No se ha podido obtener información para la parada ${stopId}. Comprueba el número.`,
            { type: "error", duration: 5000 }
        );
        return false;
    }

    const fav = { id: stopId, label: `Parada ${stopId}` };
    if (filterLines && filterLines.length) fav.filterLines = filterLines;

    if (!addFavorite(fav)) return false;

    try {
        await fetchStopCoords(stopId);
    } catch (e) {
        console.warn("No se pudieron obtener coords para la favorita", stopId);
    }

    await renderFavorites();
    renderStop(fav, arrivals);
    return true;
}

// --- Renderizado de paradas cercanas como acordeones ---
export async function renderNearbyStops(stops) {
    const nearbyAccordionEl = document.getElementById("nearby-accordion");
    if (!nearbyAccordionEl) return;

    const prevOpenIds = new Set();
    const prevItems = nearbyAccordionEl.querySelectorAll(".accordion-item.open");
    prevItems.forEach(item => {
        const id = item.dataset.stopId;
        if (id) prevOpenIds.add(String(id));
    });

    nearbyAccordionEl.innerHTML = "";

    if (!stops || !stops.length) {
        const div = document.createElement("div");
        div.className = "empty";
        div.textContent = "Sin paradas cercanas en el radio seleccionado.";
        nearbyAccordionEl.appendChild(div);
        return;
    }

    const baseIds = new Set(STOPS.map(s => String(s.id)));

    const filtered = stops
        .map(stop => {
            const stopId =
                stop.stopId ??
                stop.IdStop ??
                stop.idStop ??
                stop.id ??
                stop.stopNum ??
                null;
            return { raw: stop, stopId };
        })
        .filter(s => s.stopId != null && !baseIds.has(String(s.stopId)));

    if (!filtered.length) {
        const div = document.createElement("div");
        div.className = "empty";
        div.textContent = "Las paradas cercanas ya están entre tus paradas favoritas o añadidas.";
        nearbyAccordionEl.appendChild(div);
        return;
    }

    const topN = filtered.slice(0, 34);
    const stopConfigs = [];

    for (const { raw: stop, stopId } of topN) {
        const idNum = parseInt(stopId, 10);
        const name =
            stop.name ??
            stop.stopName ??
            stop.StopName ??
            `Parada ${idNum}`;

        if (stop.geometry && Array.isArray(stop.geometry.coordinates)) {
            const coords = stop.geometry.coordinates;
            const lon = parseFloat(coords[0]);
            const lat = parseFloat(coords[1]);
            if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
                STOP_COORDS[idNum] = { lat, lon };
            }
        }

        const cfg = { id: idNum };
        if (nearbyLineFilter) {
            cfg.filterLines = [nearbyLineFilter];
        }

        const article = buildStopAccordionElement(cfg, {
            title: name,
            subtitle: `Parada ${idNum} · Cercana a tu ubicación`,
            open: prevOpenIds.has(String(idNum)),
            actions: [
                {
                    icon: "★",
                    title: "Añadir a favoritas",
                    onClick: async () => {
                        const fav = { id: idNum, label: name };
                        if (nearbyLineFilter) fav.filterLines = [nearbyLineFilter];
                        if (addFavorite(fav)) {
                            await renderFavorites();
                            await refreshStop(fav);
                        }
                    }
                }
            ]
        });

        nearbyAccordionEl.appendChild(article);
        updateLocationLink(idNum);
        renderAlarmsForStop(idNum);
        stopConfigs.push(cfg);
    }

    await Promise.all(stopConfigs.map(cfg => refreshStop(cfg)));
}

// ---- ACCORDIÓN ESTÁTICO (compat — ya no hay favoritas estáticas, pero se conserva por si acaso) ----
export function setupAccordionListeners() {
    // Las favoritas ahora se generan dinámicamente y registran sus propios listeners.
    // Mantenemos la función para que no rompa imports antiguos.
}

// ---- PARADAS DINÁMICAS ("Mis paradas") ----
export function renderDynamicStops(normalizeLineFn) {
    const container = document.getElementById("dynamic-stops");
    if (!container) return;

    // Mantener qué acordeones estaban abiertos
    const prevOpen = new Set();
    container.querySelectorAll(".accordion-item.open").forEach(item => {
        if (item.dataset.stopId) prevOpen.add(item.dataset.stopId);
    });

    container.innerHTML = "";

    if (!DYNAMIC_STOPS.length) {
        return;
    }

    DYNAMIC_STOPS.forEach(stop => {
        const wasOpen = prevOpen.size === 0 || prevOpen.has(String(stop.id));

        const article = buildStopAccordionElement(stop, {
            title: `Parada ${stop.id}`,
            subtitle: `Número de parada ${stop.id}`,
            open: wasOpen,
            actions: [
                {
                    icon: "★",
                    title: "Añadir a favoritas",
                    onClick: async () => {
                        const fav = { id: stop.id, label: `Parada ${stop.id}` };
                        if (addFavorite(fav)) {
                            // También quitarla de Mis paradas para no duplicar polling
                            removeDynamicStop(stop.id);
                            await renderFavorites();
                            renderDynamicStops(normalizeLineFn);
                            await refreshStop(fav);
                            toast(`Parada ${stop.id} movida a favoritas.`, { type: "success" });
                        } else {
                            toast(`La parada ${stop.id} ya está en favoritas.`, { type: "warn" });
                        }
                    }
                },
                {
                    icon: "✕",
                    title: "Quitar de Mis paradas",
                    danger: true,
                    onClick: async () => {
                        const ok = await confirmDialog(
                            `¿Quitar la parada ${stop.id} de Mis paradas?`,
                            { okText: "Quitar", danger: true }
                        );
                        if (!ok) return;
                        removeDynamicStop(stop.id);
                        renderDynamicStops(normalizeLineFn);
                        toast(`Parada ${stop.id} quitada.`, { type: "success" });
                    }
                }
            ]
        });

        container.appendChild(article);
        updateLocationLink(stop.id);
        renderAlarmsForStop(stop.id);
    });

    // Reaplicar filtro de línea si hay
    const myLineInput = document.getElementById("my-line-input");
    if (myLineInput && normalizeLineFn && myLineInput.value.trim()) {
        filterMyStopsByLine(myLineInput.value.trim(), normalizeLineFn);
    }
}

export async function createDynamicStopAccordion(stopId, normalizeLineFn) {
    if (STOPS.some(s => s.id === stopId)) {
        const existing = document.querySelector(
            `.accordion-item[data-stop-id="${stopId}"]`
        );
        if (existing) {
            existing.classList.add("open");
        }
        await refreshStop({ id: stopId });
        return;
    }

    let arrivals;
    try {
        arrivals = await getArrivals(stopId);
    } catch (err) {
        console.error(err);
        toast(
            `No se ha podido obtener información para la parada ${stopId}. Comprueba el número.`,
            { type: "error", duration: 5000 }
        );
        return;
    }

    const stopConfig = { id: stopId, label: `Parada ${stopId}` };
    if (!addDynamicStop(stopConfig)) return;

    try {
        await fetchStopCoords(stopId);
    } catch (e) {
        console.warn("No se pudieron obtener coords para la parada dinámica", stopId);
    }

    // Re-render completo de Mis paradas (incluye la nueva), y aprovechamos
    // los arrivals ya obtenidos para pintar inmediatamente la parada recién
    // creada sin esperar otra llamada al endpoint.
    renderDynamicStops(normalizeLineFn);
    renderStop(stopConfig, arrivals);
}

// ---- Filtro "mis paradas" ----
export function filterMyStopsByLine(filterVal, normalizeLineFn) {
    const normalized = filterVal ? normalizeLineFn(filterVal) : "";
    const dynamicStopsContainer = document.getElementById("dynamic-stops");
    if (!dynamicStopsContainer) return;

    const items = dynamicStopsContainer.querySelectorAll(".accordion-item");

    items.forEach(item => {
        const stopId = parseInt(item.dataset.stopId, 10);
        if (!normalized) {
            item.style.display = "";
            return;
        }
        const lines = STOP_LINES[stopId] || [];
        if (lines.some(l => l === normalized)) {
            item.style.display = "";
        } else {
            item.style.display = "none";
        }
    });
}
