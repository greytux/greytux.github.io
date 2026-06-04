// incidents.js — incidencias/avisos de servicio por línea.
// Una sola llamada (todas las líneas) construye un mapa línea -> incidencias.
// Se refresca como mucho cada 10 min (cambian despacio).

import { getIncidents } from "./apiEmt.js";
import { infoDialog } from "./toast.js";

const REFRESH_MS = 10 * 60 * 1000;

let byLine = new Map();
let lastLoaded = 0;
let loading = null;

function normLine(l) {
    if (l == null) return "";
    return String(l).trim().replace(/^0+/, "");
}

// Convierte el HTML de la descripción en texto plano sin cargar recursos
// (DOMParser sobre un documento NO insertado no descarga imágenes ni ejecuta).
function htmlToText(html) {
    if (!html) return "";
    try {
        const doc = new DOMParser().parseFromString(String(html), "text/html");
        return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
    } catch {
        return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
}

function parseItem(item) {
    return {
        title: item.title || "Incidencia",
        text: htmlToText(item.description),
        link: item.link || (item.enclosure && item.enclosure["@url"]) || "",
        from: item.rssAfectaDesde || "",
        to: item.rssAfectaHasta || "",
        lines: Array.isArray(item.category) ? item.category.map(normLine).filter(Boolean) : []
    };
}

export async function refreshIncidents(force = false) {
    if (!force && Date.now() - lastLoaded < REFRESH_MS) return;
    if (loading) return loading;

    loading = (async () => {
        const items = await getIncidents();
        const map = new Map();
        items.forEach(raw => {
            const inc = parseItem(raw);
            inc.lines.forEach(line => {
                if (!map.has(line)) map.set(line, []);
                map.get(line).push(inc);
            });
        });
        byLine = map;
        lastLoaded = Date.now();
        loading = null;
    })();

    return loading;
}

export function getIncidentsForLine(line) {
    return byLine.get(normLine(line)) || [];
}

function buildContent(incidents) {
    const wrap = document.createElement("div");
    incidents.forEach(inc => {
        const item = document.createElement("div");
        item.className = "incident-item";

        const h = document.createElement("div");
        h.className = "incident-title";
        h.textContent = inc.title;
        item.appendChild(h);

        if (inc.from || inc.to) {
            const d = document.createElement("div");
            d.className = "incident-dates";
            d.textContent = [
                inc.from && `Desde ${inc.from}`,
                inc.to && `hasta ${inc.to}`
            ].filter(Boolean).join(" · ");
            item.appendChild(d);
        }

        if (inc.text) {
            const p = document.createElement("div");
            p.className = "incident-text";
            p.textContent = inc.text;
            item.appendChild(p);
        }

        if (inc.link) {
            const a = document.createElement("a");
            a.className = "incident-link";
            a.href = inc.link;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = "Más información ↗";
            item.appendChild(a);
        }

        wrap.appendChild(item);
    });
    return wrap;
}

export function showIncidentsForLine(line) {
    const incidents = getIncidentsForLine(line);
    if (!incidents.length) return;
    infoDialog(`⚠️ Incidencias · línea ${normLine(line)}`, buildContent(incidents));
}
