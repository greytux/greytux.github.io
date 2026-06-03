import {
    STOPS,
    FAVORITES,
    STOP_COORDS,
    STOP_LINES,
    nearbyLineFilter,
    favoritesLineFilter,
    userLocation,
    addFavorite,
    removeFavorite,
    moveFavorite,
    setFavoriteCoords
} from "./state.js";

import { openCoordPicker } from "./coordPicker.js";

import { estimateWalk, computeVerdict } from "./walkTime.js";

import { getDelayInfo } from "./etaTracker.js";

import {
    getArrivals,
    fetchStopCoords,
    getStopLinesFromRawStop
} from "./apiEmt.js";

import { toast, confirmDialog } from "./toast.js";

import {
    evaluateAlarmsForStop,
    renderAlarmsForStop
} from "./alarms.js";

// Normaliza el número de línea (quita ceros a la izquierda) para comparar.
function normLine(l) {
    if (l == null) return "";
    return String(l).trim().replace(/^0+/, "");
}

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

    if (walkEl) {
        walkEl.textContent = "";
        walkEl.className = "walk-time";
    }
    listEl.innerHTML = "";

    let filtered = arrivals;
    if (filterLines && filterLines.length) {
        const wanted = filterLines.map(normLine);
        filtered = arrivals.filter(a => wanted.includes(normLine(a.line)));
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

    // ¿Llego a tiempo? Calculamos tiempo andando + veredicto si tenemos las
    // coords del usuario y de la parada.
    if (walkEl) {
        const stopCoords = STOP_COORDS[id];
        if (userLocation && stopCoords) {
            const walk = estimateWalk({
                userLat: userLocation.lat,
                userLon: userLocation.lon,
                stopLat: stopCoords.lat,
                stopLon: stopCoords.lon
            });
            const walkMin = Math.max(1, Math.round(walk.walkSec / 60));

            const busSecs = filtered
                .map(a => a.estimateArrive)
                .filter(s => s != null)
                .sort((x, y) => x - y);

            const verdict = walk.realistic
                ? computeVerdict({ walkSec: walk.walkSec, busSecs })
                : null;

            let text = `🚶 ${walkMin} min andando`;
            let kindClass = "";

            if (verdict) {
                const icon =
                    verdict.kind === "comfortable" ? "✓"
                    : verdict.kind === "tight" ? "⚠"
                    : verdict.kind === "urgent" ? "⚡"
                    : verdict.kind === "miss-catch-next" ? "→"
                    : "⛔";
                text += ` · ${icon} ${verdict.text}`;
                kindClass = `verdict-${verdict.kind}`;
            } else if (!walk.realistic) {
                text += " · parada lejana";
            }

            walkEl.textContent = text;
            walkEl.className = `walk-time ${kindClass}`.trim();
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

            const delay = getDelayInfo(id, arr);

            let className = "bus-item";
            if (minutes != null) {
                if (minutes < 3) {
                    className += " urgent";
                } else if (minutes <= 10) {
                    className += " soon";
                }
            }
            if (delay) className += " delayed";
            li.className = className;

            const left = document.createElement("div");
            left.className = "bus-left";

            const lineBadge = document.createElement("div");
            lineBadge.className = "line-badge";
            lineBadge.innerHTML = `<span class="line-text">${arr.line}</span>`;

            const textBlock = document.createElement("div");
            textBlock.className = "bus-text";

            const distancePart = arr.DistanceBus != null
                ? `${arr.DistanceBus} m`
                : "-";
            const delayPart = delay
                ? `<span class="bus-delay ${delay.severity === "high" ? "bus-delay-high" : ""}">⏰ +${delay.slipMin} min retraso</span>`
                : "";

            textBlock.innerHTML = `
        <div class="bus-main">${arr.destination || "Destino no disponible"}</div>
        <div class="bus-sub">
          Bus a ${distancePart}${delayPart ? " · " + delayPart : ""}
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
        <div class="status" id="status-${id}" aria-live="polite">
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
                    icon: "📍",
                    title: STOP_COORDS[fav.id]
                        ? "Editar ubicación"
                        : "Fijar ubicación",
                    onClick: async () => {
                        const result = await openCoordPicker({
                            stopId: fav.id,
                            stopName: favoriteTitle(fav)
                        });
                        if (!result) return;
                        if (setFavoriteCoords(fav.id, result.lat, result.lon)) {
                            await renderFavorites();
                            updateLocationLink(fav.id);
                            toast("Ubicación guardada.", { type: "success" });
                        }
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

// Lleva al usuario a una parada concreta: cambia a su pestaña, abre su
// acordeón y hace scroll hasta él.
export function focusStopAccordion(stopId) {
    const article = document.querySelector(
        `.accordion-item[data-stop-id="${stopId}"]`
    );
    if (!article) return false;

    const slide = article.closest(".slide");
    const idx = slide ? parseInt(slide.dataset.slide, 10) : 0;
    const tab = document.querySelector(`.tab-btn[data-index="${idx}"]`);
    if (tab) tab.click();

    if (!article.classList.contains("open")) {
        article.querySelector(".accordion-header")?.click();
    }

    requestAnimationFrame(() => {
        article.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return true;
}

// --- Añadir favorita desde formulario ---
export async function handleAddFavorite(stopId, filterLines) {
    if (FAVORITES.some(s => s.id === stopId)) {
        toast(`La parada ${stopId} ya está en favoritas. Te llevo a ella.`, { type: "info" });
        focusStopAccordion(stopId);
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

    // Recordar qué acordeones estaban abiertos (antes de tocar el DOM)
    const prevOpenIds = new Set();
    nearbyAccordionEl.querySelectorAll(".accordion-item.open").forEach(item => {
        if (item.dataset.stopId) prevOpenIds.add(String(item.dataset.stopId));
    });

    const showMessage = (text) => {
        nearbyAccordionEl.innerHTML = "";
        const div = document.createElement("div");
        div.className = "empty";
        div.textContent = text;
        nearbyAccordionEl.appendChild(div);
    };

    if (!stops || !stops.length) {
        showMessage("Sin paradas cercanas en el radio seleccionado.");
        return;
    }

    const baseIds = new Set(STOPS.map(s => String(s.id)));
    let candidates = stops
        .map(stop => {
            const stopId =
                stop.stopId ?? stop.IdStop ?? stop.idStop ?? stop.id ?? stop.stopNum ?? null;
            return { raw: stop, stopId };
        })
        .filter(s => s.stopId != null && !baseIds.has(String(s.stopId)));

    if (!candidates.length) {
        showMessage("Las paradas cercanas ya están entre tus favoritas.");
        return;
    }

    const filterActive = !!nearbyLineFilter;

    // Pre-filtro estático por líneas servidas: descartamos de entrada las
    // paradas que no tienen la línea (ni se piden sus llegadas). Las de líneas
    // desconocidas se mantienen y se deciden tras pedir las llegadas.
    if (filterActive) {
        candidates = candidates.filter(({ raw }) => {
            const served = getStopLinesFromRawStop(raw);
            return served.length === 0 || served.includes(nearbyLineFilter);
        });
        if (!candidates.length) {
            showMessage(`Ninguna parada cercana tiene la línea ${nearbyLineFilter}.`);
            return; // cero fetch, cero refresco
        }
    }

    const topN = candidates.slice(0, 34);

    // Cachear coords de las candidatas (barato, síncrono)
    topN.forEach(({ raw, stopId }) => {
        const idNum = parseInt(stopId, 10);
        if (raw.geometry && Array.isArray(raw.geometry.coordinates)) {
            const lon = parseFloat(raw.geometry.coordinates[0]);
            const lat = parseFloat(raw.geometry.coordinates[1]);
            if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
                STOP_COORDS[idNum] = { lat, lon };
            }
        }
    });

    const nameOf = (raw, idNum) =>
        raw.name ?? raw.stopName ?? raw.StopName ?? `Parada ${idNum}`;

    const buildArticle = (idNum, name, cfg, arrivals) => {
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
        if (arrivals !== undefined) renderStop(cfg, arrivals);
    };

    if (filterActive) {
        // Fetch-first: pedimos llegadas y solo pintamos las paradas que tienen
        // un bus de la línea ahora mismo. Sin acordeones vacíos ni parpadeo:
        // el listado anterior permanece visible hasta tener los datos nuevos.
        const results = await Promise.all(topN.map(async ({ raw, stopId }) => {
            const idNum = parseInt(stopId, 10);
            let arrivals = [];
            try {
                arrivals = await getArrivals(idNum);
            } catch (e) {
                /* ignoramos esta parada en este ciclo */
            }
            const has = arrivals.some(a =>
                a.estimateArrive != null && normLine(a.line) === nearbyLineFilter
            );
            return { raw, idNum, arrivals, has };
        }));

        const visible = results.filter(r => r.has);
        nearbyAccordionEl.innerHTML = "";
        if (!visible.length) {
            showMessage(
                `No hay buses de la línea ${nearbyLineFilter} en paradas cercanas ahora mismo.`
            );
            return;
        }
        visible.forEach(({ raw, idNum, arrivals }) => {
            const cfg = { id: idNum, filterLines: [nearbyLineFilter] };
            buildArticle(idNum, nameOf(raw, idNum), cfg, arrivals);
        });
        return;
    }

    // Sin filtro: comportamiento normal (construir todos + refrescar)
    nearbyAccordionEl.innerHTML = "";
    const stopConfigs = [];
    for (const { raw, stopId } of topN) {
        const idNum = parseInt(stopId, 10);
        const cfg = { id: idNum };
        buildArticle(idNum, nameOf(raw, idNum), cfg, undefined);
        stopConfigs.push(cfg);
    }
    await Promise.all(stopConfigs.map(cfg => refreshStop(cfg)));
}

// Aplica el filtro de línea de Favoritas: oculta las favoritas que no tienen
// la línea (por líneas servidas conocidas) o que ahora mismo no muestran ningún
// bus de esa línea. Se llama tras cada refresco y al teclear en el filtro.
export function applyFavoritesFilter() {
    const container = document.getElementById("favorites-stops");
    if (!container) return;

    const f = favoritesLineFilter;
    const msgEl = document.getElementById("fav-filter-message");

    if (!f) {
        container.querySelectorAll(".accordion-item").forEach(a => {
            a.style.display = "";
        });
        if (msgEl) msgEl.textContent = "";
        return;
    }

    let anyVisible = false;
    container.querySelectorAll(".accordion-item").forEach(article => {
        const id = parseInt(article.dataset.stopId, 10);
        const served = STOP_LINES[id];
        let show;
        if (Array.isArray(served) && served.length && !served.includes(f)) {
            show = false; // la línea no pasa por esta parada
        } else {
            const busList = document.getElementById(`buses-${id}`);
            show = !!(busList && busList.querySelector(".bus-item"));
        }
        article.style.display = show ? "" : "none";
        if (show) anyVisible = true;
    });

    if (msgEl) {
        msgEl.textContent = anyVisible
            ? ""
            : `Ninguna favorita con buses de la línea ${f} ahora mismo.`;
    }
}

// ---- ACCORDIÓN ESTÁTICO (compat — ya no hay favoritas estáticas, pero se conserva por si acaso) ----
export function setupAccordionListeners() {
    // Las favoritas ahora se generan dinámicamente y registran sus propios listeners.
    // Mantenemos la función para que no rompa imports antiguos.
}

// Las paradas se gestionan ahora únicamente desde Favoritas; "Mis paradas"
// se ha eliminado para no duplicar funcionalidad (ver renderFavorites).
