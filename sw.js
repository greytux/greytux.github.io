// Service worker para Turrobuses
// - Cachea el "shell" estático (HTML/CSS/JS/manifest) para uso offline
// - NO cachea llamadas a la API EMT: deben ir siempre a red para no
//   mostrar tiempos de bus rancios.

const CACHE_VERSION = "turrobuses-shell-v10";
const SHELL_ASSETS = [
    "./",
    "./index.html",
    "./styles.css",
    "./manifest.webmanifest",
    "./js/main.js",
    "./js/state.js",
    "./js/apiEmt.js",
    "./js/uiStops.js",
    "./js/slider.js",
    "./js/toast.js",
    "./js/alarms.js",
    "./js/map.js",
    "./js/coordPicker.js",
    "./js/walkTime.js",
    "./js/etaTracker.js",
    "./js/shortcuts.js"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((k) => k !== CACHE_VERSION)
                    .map((k) => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);

    // Las llamadas a EMT no se cachean: siempre van por red.
    if (url.hostname.includes("emtmadrid.es")) return;

    // Solo gestionamos peticiones del mismo origen (el shell).
    if (url.origin !== self.location.origin) return;

    // Estrategia: cache primero, red como respaldo. En caso de éxito de red
    // actualizamos la cache para que la próxima visita esté fresca.
    event.respondWith(
        caches.match(req).then((cached) => {
            const networkFetch = fetch(req)
                .then((res) => {
                    if (res && res.ok) {
                        const copy = res.clone();
                        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() => cached);
            return cached || networkFetch;
        })
    );
});
