// shortcuts.js — atajos diarios (Casa / Trabajo) + manejo de URL params para
// abrir directamente una parada (ya sea por id o por nombre del atajo).

import { FAVORITES, STOPS } from "./state.js";

const STORAGE_KEY = "greytux:shortcuts:v1";

function loadShortcuts() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        const clean = {};
        for (const key of ["casa", "trabajo"]) {
            const v = parseInt(parsed[key], 10);
            if (Number.isFinite(v) && v > 0) clean[key] = v;
        }
        return clean;
    } catch {
        return {};
    }
}

function persistShortcuts(s) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) {
        console.warn("No se pudo guardar atajos", e);
    }
}

let shortcutsCache = loadShortcuts();

export function getShortcuts() {
    return { ...shortcutsCache };
}

export function setShortcut(key, stopId) {
    if (!["casa", "trabajo"].includes(key)) return false;
    if (stopId == null || stopId === "") {
        delete shortcutsCache[key];
    } else {
        const n = parseInt(stopId, 10);
        if (!Number.isFinite(n) || n <= 0) return false;
        shortcutsCache[key] = n;
    }
    persistShortcuts(shortcutsCache);
    return true;
}

// Localizar el acordeón de una parada, abrirla, cambiar a la pestaña que la
// contiene y hacer scroll hasta ella.
function focusStopAccordion(stopId) {
    const article = document.querySelector(
        `.accordion-item[data-stop-id="${stopId}"]`
    );
    if (!article) return false;

    // Determinar a qué slide pertenece (subir hasta encontrar el .slide padre)
    let slide = article.closest(".slide");
    const slideIdx = slide ? parseInt(slide.dataset.slide, 10) : 0;
    const tab = document.querySelector(`.tab-btn[data-index="${slideIdx}"]`);
    if (tab) tab.click();

    if (!article.classList.contains("open")) {
        article.querySelector(".accordion-header")?.click();
    }

    requestAnimationFrame(() => {
        article.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    return true;
}

// Llamado al cargar la app. Lee los URL params y dirige al usuario al destino.
// Devuelve la id de la parada en la que aterrizar, o null.
export function consumeUrlIntent({ toast } = {}) {
    const params = new URLSearchParams(window.location.search);
    const direct = params.get("parada");
    const atajo = params.get("atajo");

    let stopId = null;
    let source = null;

    if (direct) {
        const n = parseInt(direct, 10);
        if (Number.isFinite(n) && n > 0) {
            stopId = n;
            source = "parada";
        }
    } else if (atajo) {
        const map = loadShortcuts();
        if (map[atajo]) {
            stopId = map[atajo];
            source = `atajo-${atajo}`;
        } else if (toast) {
            toast(
                `Atajo "${atajo}" sin configurar. Hazlo en la pestaña Favoritas.`,
                { type: "warn", duration: 5000 }
            );
        }
    }

    // Limpiar la URL para que recargas posteriores no reaterricen
    if (direct || atajo) {
        const url = new URL(window.location.href);
        url.searchParams.delete("parada");
        url.searchParams.delete("atajo");
        window.history.replaceState({}, "", url.toString());
    }

    if (stopId == null) return null;

    // Si la parada está en STOPS, esperamos a que se haya renderizado.
    // Si no, no la conocemos: avisamos.
    const knownStop = STOPS.find(s => s.id === stopId);
    if (!knownStop && toast) {
        toast(
            `Parada ${stopId} no está en favoritas ni Mis paradas. Añádela primero.`,
            { type: "warn", duration: 5000 }
        );
        return null;
    }

    // Doble RAF para asegurar que el render inicial ha terminado.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => focusStopAccordion(stopId));
    });
    return stopId;
}

// UI: render del bloque de configuración de atajos en la pestaña Favoritas.
export function renderShortcutsConfig(containerId = "shortcuts-config") {
    const container = document.getElementById(containerId);
    if (!container) return;

    const allOptions = [...FAVORITES];
    const optionsHtml = allOptions
        .map(s => {
            const label = s.label || `Parada ${s.id}`;
            return `<option value="${s.id}">${label}</option>`;
        })
        .join("");

    container.innerHTML = `
      <details class="shortcuts-details">
        <summary class="shortcuts-summary">
          <span>🏠 🏢 Atajos rápidos</span>
          <span class="shortcuts-meta" id="shortcuts-meta"></span>
        </summary>
        <div class="shortcuts-form">
          <label class="shortcuts-row">
            <span class="shortcuts-label">🏠 Casa</span>
            <select id="shortcut-casa" class="shortcuts-select">
              <option value="">(sin asignar)</option>
              ${optionsHtml}
            </select>
          </label>
          <label class="shortcuts-row">
            <span class="shortcuts-label">🏢 Trabajo</span>
            <select id="shortcut-trabajo" class="shortcuts-select">
              <option value="">(sin asignar)</option>
              ${optionsHtml}
            </select>
          </label>
          <div class="shortcuts-help">
            En Android, mantén pulsado el icono de la PWA instalada para usar los atajos.
            También puedes compartir un enlace tipo <code>?parada=NNNN</code>.
          </div>
        </div>
      </details>
    `;

    const casaSel = container.querySelector("#shortcut-casa");
    const trabSel = container.querySelector("#shortcut-trabajo");
    const meta = container.querySelector("#shortcuts-meta");

    function refreshMeta() {
        const s = getShortcuts();
        const parts = [];
        if (s.casa) parts.push(`Casa→${s.casa}`);
        if (s.trabajo) parts.push(`Trabajo→${s.trabajo}`);
        meta.textContent = parts.length ? parts.join(" · ") : "sin configurar";
    }

    // Preseleccionar valores actuales
    const cur = getShortcuts();
    if (cur.casa) casaSel.value = String(cur.casa);
    if (cur.trabajo) trabSel.value = String(cur.trabajo);
    refreshMeta();

    casaSel.addEventListener("change", () => {
        setShortcut("casa", casaSel.value || null);
        refreshMeta();
    });
    trabSel.addEventListener("change", () => {
        setShortcut("trabajo", trabSel.value || null);
        refreshMeta();
    });
}
