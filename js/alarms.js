// alarms.js — alarmas locales "avísame cuando la línea X esté a Y min".
// La alarma se evalúa tras cada renderStop. Cuando dispara: notificación nativa
// (si hay permiso) + toast + vibración. La alarma se autoelimina al dispararse.

import {
    ALARMS,
    addAlarm,
    removeAlarm,
    getAlarmsForStop
} from "./state.js";

import { toast } from "./toast.js";

let permissionRequested = false;

export function hasAnyAlarms() {
    return ALARMS.length > 0;
}

export function getAlarmedStopIds() {
    return [...new Set(ALARMS.map(a => a.stopId))];
}

async function ensureNotificationPermission() {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    if (permissionRequested) return Notification.permission;
    permissionRequested = true;
    try {
        const result = await Notification.requestPermission();
        return result;
    } catch {
        return "denied";
    }
}

function fireAlarm(alarm, arrival) {
    const minutes = arrival.estimateArrive != null
        ? Math.max(0, Math.round(arrival.estimateArrive / 60))
        : null;
    const minutesTxt = minutes === 0 ? "llegando" : `~${minutes} min`;
    const body = `Línea ${alarm.line} en parada ${alarm.stopId}: ${minutesTxt}`;

    if ("Notification" in window && Notification.permission === "granted") {
        try {
            const n = new Notification("🐶 Turrobuses", {
                body,
                icon: "./icons/icon-192.png",
                badge: "./icons/icon-192.png",
                tag: `alarm-${alarm.id}`,
                renotify: true
            });
            n.onclick = () => {
                window.focus();
                n.close();
            };
        } catch (e) {
            console.warn("No se pudo lanzar Notification", e);
        }
    }

    toast(`🚌 ${body}`, { type: "success", duration: 8000 });

    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        try { navigator.vibrate([200, 100, 200]); } catch {}
    }
}

// Llamada por renderStop después de pintar las llegadas.
export function evaluateAlarmsForStop(stopId, arrivals) {
    const alarms = getAlarmsForStop(stopId);
    if (!alarms.length || !arrivals || !arrivals.length) return;

    for (const alarm of alarms) {
        const matching = arrivals.find(a => {
            if (String(a.line).trim().replace(/^0+/, "") !== alarm.line) return false;
            if (a.estimateArrive == null) return false;
            const m = Math.round(a.estimateArrive / 60);
            return m <= alarm.threshold;
        });
        if (matching) {
            fireAlarm(alarm, matching);
            removeAlarm(alarm.id);
        }
    }
}

// ---- UI: sección de alarmas dentro del panel de cada parada ----
export function renderAlarmsForStop(stopId) {
    const container = document.getElementById(`alarms-${stopId}`);
    if (!container) return;

    container.innerHTML = "";

    const alarms = getAlarmsForStop(stopId);

    const title = document.createElement("div");
    title.className = "alarms-title";
    title.textContent = "🔔 Alarmas";
    container.appendChild(title);

    const chips = document.createElement("div");
    chips.className = "alarms-chips";

    if (alarms.length === 0) {
        const empty = document.createElement("div");
        empty.className = "alarms-empty";
        empty.textContent = "Sin alarmas. Avísame cuando una línea esté a X min.";
        chips.appendChild(empty);
    } else {
        alarms.forEach(alarm => {
            const chip = document.createElement("span");
            chip.className = "alarm-chip";
            chip.innerHTML = `
                <span class="alarm-chip-text">Línea ${alarm.line} ≤ ${alarm.threshold} min</span>
                <button type="button" class="alarm-chip-remove" title="Quitar alarma" aria-label="Quitar alarma">✕</button>
            `;
            chip.querySelector(".alarm-chip-remove").addEventListener("click", () => {
                removeAlarm(alarm.id);
                renderAlarmsForStop(stopId);
            });
            chips.appendChild(chip);
        });
    }
    container.appendChild(chips);

    const form = document.createElement("form");
    form.className = "alarm-form";
    form.innerHTML = `
        <input type="text"  class="alarm-line"      inputmode="numeric" placeholder="Línea (ej: 137)" />
        <input type="number" class="alarm-threshold" inputmode="numeric" min="0" max="60" placeholder="min" />
        <button type="submit" class="alarm-add-btn" title="Añadir alarma">Añadir</button>
    `;

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const lineInput = form.querySelector(".alarm-line");
        const threshInput = form.querySelector(".alarm-threshold");
        const lineRaw = (lineInput.value || "").trim();
        const threshRaw = (threshInput.value || "").trim();
        const threshold = parseInt(threshRaw, 10);

        if (!lineRaw) {
            toast("Indica la línea.", { type: "error" });
            return;
        }
        if (Number.isNaN(threshold) || threshold < 0 || threshold > 60) {
            toast("Indica un umbral válido (0-60 min).", { type: "error" });
            return;
        }

        const created = addAlarm({ stopId, line: lineRaw, threshold });
        if (!created) {
            toast("Esa alarma ya existe.", { type: "warn" });
            return;
        }

        const perm = await ensureNotificationPermission();
        if (perm === "granted") {
            toast(`Alarma activada: línea ${created.line} ≤ ${created.threshold} min.`, { type: "success" });
        } else if (perm === "denied" || perm === "unsupported") {
            toast(
                `Alarma activada (sin notificaciones del sistema, solo aviso en pantalla).`,
                { type: "warn", duration: 5000 }
            );
        }

        lineInput.value = "";
        threshInput.value = "";
        renderAlarmsForStop(stopId);
    });

    container.appendChild(form);
}
