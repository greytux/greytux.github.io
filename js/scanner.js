// scanner.js — lector de QR de paradas EMT en vivo.
//
// Usamos la librería html5-qrcode (cargada bajo demanda desde CDN) en lugar de
// manejar getUserMedia a mano: tiene resueltos los problemas de cámara en
// Safari/iOS (preview en negro, playsinline, selección de cámara, etc.).

const HTML5QRCODE_URL = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";

let libPromise = null;
function loadLib() {
    if (window.Html5Qrcode) return Promise.resolve();
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = HTML5QRCODE_URL;
        s.onload = () => resolve();
        s.onerror = () => {
            libPromise = null;
            reject(new Error("No se pudo cargar el lector de QR."));
        };
        document.head.appendChild(s);
    });
    return libPromise;
}

// Extrae el número de parada del contenido del QR. El QR de la EMT es una URL
// tipo https://www.emtmadrid.es/PMVVisor/pmv.aspx?stopnum=2677&size=3
export function parseStopIdFromQr(text) {
    if (!text) return null;

    try {
        const u = new URL(text);
        const sn =
            u.searchParams.get("stopnum") ||
            u.searchParams.get("stop") ||
            u.searchParams.get("parada");
        if (sn && /^\d+$/.test(sn)) return parseInt(sn, 10);
    } catch {
        /* no es una URL absoluta, seguimos con los patrones */
    }

    const m =
        text.match(/stop(?:num)?=(\d+)/i) ||
        text.match(/parada[=/](\d+)/i);
    if (m) return parseInt(m[1], 10);

    const n = text.match(/\b(\d{1,5})\b/);
    if (n) return parseInt(n[1], 10);

    return null;
}

// Abre el lector de QR en vivo y resuelve con el número de parada, o null.
export function openQrScanner() {
    return new Promise((resolve) => {
        let settled = false;
        let scanner = null;

        const overlay = document.createElement("div");
        overlay.className = "scanner-overlay";
        overlay.innerHTML = `
            <div class="scanner-modal" role="dialog" aria-modal="true" aria-label="Escanear QR de la parada">
                <div class="scanner-header">
                    <div class="scanner-title">Escanea el QR de la parada</div>
                    <button type="button" class="scanner-close" aria-label="Cerrar">✕</button>
                </div>
                <div id="qr-reader-region" class="scanner-region"></div>
                <div class="scanner-status">Apunta la cámara al código QR de la marquesina.</div>
            </div>
        `;

        const statusEl = overlay.querySelector(".scanner-status");
        const closeBtn = overlay.querySelector(".scanner-close");

        const finish = async (result) => {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", onKey);
            if (scanner) {
                try { await scanner.stop(); } catch { /* ya parado */ }
                try { scanner.clear(); } catch { /* noop */ }
            }
            overlay.classList.remove("scanner-visible");
            setTimeout(() => overlay.remove(), 150);
            resolve(result);
        };

        const onKey = (e) => {
            if (e.key === "Escape") finish(null);
        };

        closeBtn.addEventListener("click", () => finish(null));
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) finish(null);
        });
        document.addEventListener("keydown", onKey);

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add("scanner-visible"));

        const onScanSuccess = (decodedText) => {
            const stopId = parseStopIdFromQr(decodedText);
            if (stopId != null) {
                finish(stopId);
            } else {
                statusEl.textContent = "QR leído pero sin número de parada reconocible.";
            }
        };

        const start = async () => {
            try {
                statusEl.textContent = "Preparando la cámara…";
                await loadLib();
                scanner = new window.Html5Qrcode("qr-reader-region", { verbose: false });
                await scanner.start(
                    { facingMode: "environment" },
                    {
                        fps: 10,
                        qrbox: (vw, vh) => {
                            const m = Math.floor(Math.min(vw, vh) * 0.7);
                            return { width: m, height: m };
                        }
                    },
                    onScanSuccess,
                    () => { /* fallo por frame: lo ignoramos */ }
                );
                statusEl.textContent = "Apunta la cámara al código QR de la marquesina.";
            } catch (err) {
                console.warn("No se pudo iniciar el lector de QR", err);
                const name = err && (err.name || err);
                statusEl.textContent =
                    name === "NotAllowedError"
                        ? "Permiso de cámara denegado. Actívalo para escanear."
                        : (err && err.message) || "No se pudo acceder a la cámara.";
            }
        };

        start();
    });
}
