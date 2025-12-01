import {
    STOPS,
    STOP_COORDS,
    STOP_LINES,
    nearbyLineFilter,
    userLocation
} from "./state.js";

import {
    getArrivals,
    fetchStopCoords
} from "./apiEmt.js";

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
                if (minutes < 15) {
                    className += " urgent";
                } else if (minutes < 20) {
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
                if (minutes < 10) {
                    label.textContent = "Muy justo";
                } else if (minutes < 15) {
                    label.textContent = "Justo";
                } else if (minutes < 20) {
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

        const article = document.createElement("article");
        article.className = "accordion-item";
        article.dataset.stopId = String(idNum);

        if (prevOpenIds.has(String(idNum))) {
            article.classList.add("open");
        }

        article.innerHTML = `
      <button class="accordion-header">
        <div class="accordion-header-main">
          <div class="stop-name">${name}</div>
          <div class="stop-subtitle">Parada ${idNum} · Cercana a tu ubicación</div>
        </div>
        <span class="badge">${idNum}</span>
      </button>
      <div class="accordion-panel">
        <div class="walk-time" id="walk-${idNum}"></div>
        <div class="reach-time" id="reach-${idNum}"></div>
        <div id="location-${idNum}" class="location-link-container"></div>
        <div class="status" id="status-${idNum}">
          <span class="status-dot"></span>
          <span>Cargando…</span>
        </div>
        <ul class="bus-list" id="buses-${idNum}"></ul>
      </div>
    `;

        nearbyAccordionEl.appendChild(article);

        const header = article.querySelector(".accordion-header");
        header.addEventListener("click", () => {
            article.classList.toggle("open");
        });

        updateLocationLink(idNum);

        const cfg = { id: idNum };
        if (nearbyLineFilter) {
            cfg.filterLines = [nearbyLineFilter];
        }
        stopConfigs.push(cfg);
    }

    await Promise.all(stopConfigs.map(cfg => refreshStop(cfg)));
}

// ---- ACCORDIÓN ESTÁTICO (favoritas ya existentes en HTML) ----
export function setupAccordionListeners() {
    const items = document.querySelectorAll(".accordion-item");
    items.forEach(item => {
        const header = item.querySelector(".accordion-header");
        if (!header) return;
        header.addEventListener("click", () => {
            item.classList.toggle("open");
        });
    });
}

// ---- PARADAS DINÁMICAS ("Mis paradas") ----
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
        alert(
            `No se ha podido obtener información para la parada ${stopId}. Comprueba que el número es correcto.`
        );
        return;
    }

    const stopConfig = { id: stopId, label: `Parada ${stopId}` };
    STOPS.push(stopConfig);

    try {
        await fetchStopCoords(stopId);
    } catch (e) {
        console.warn("No se pudieron obtener coords para la parada dinámica", stopId);
    }

    const dynamicStopsContainer = document.getElementById("dynamic-stops");
    if (!dynamicStopsContainer) return;

    const article = document.createElement("article");
    article.className = "accordion-item open";
    article.dataset.stopId = String(stopId);

    article.innerHTML = `
    <button class="accordion-header">
      <div class="accordion-header-main">
        <div class="stop-name">Parada ${stopId}</div>
        <div class="stop-subtitle">Número de parada ${stopId}</div>
      </div>
      <span class="badge">${stopId}</span>
    </button>
    <div class="accordion-panel">
      <div class="walk-time" id="walk-${stopId}"></div>
      <div class="reach-time" id="reach-${stopId}"></div>
      <div id="location-${stopId}" class="location-link-container"></div>
      <div class="status" id="status-${stopId}">
        <span class="status-dot"></span>
        <span>Datos cargados.</span>
      </div>
      <ul class="bus-list" id="buses-${stopId}"></ul>
    </div>
  `;

    dynamicStopsContainer.appendChild(article);

    const header = article.querySelector(".accordion-header");
    header.addEventListener("click", () => {
        article.classList.toggle("open");
    });

    updateLocationLink(stopId);
    renderStop(stopConfig, arrivals);

    // Reaplicar filtro actual si hay
    const myLineInput = document.getElementById("my-line-input");
    if (myLineInput && myLineInput.value.trim()) {
        filterMyStopsByLine(myLineInput.value.trim(), normalizeLineFn);
    }
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
