// scanner.js — escáner de códigos QR de paradas EMT con la cámara.
// Usa BarcodeDetector nativo donde existe (Android/Chrome) y cae a jsQR
// (cargado bajo demanda desde CDN) en navegadores sin soporte (iPhone/Safari).

const JSQR_URL = "https://unpkg.com/jsqr@1.4.0/dist/jsQR.js";

let jsQrPromise = null;
function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (jsQrPromise) return jsQrPromise;
    jsQrPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = JSQR_URL;
        s.crossOrigin = "anonymous";
        s.onload = () => resolve(window.jsQR);
        s.onerror = () => {
            jsQrPromise = null;
            reject(new Error("No se pudo cargar el lector de QR."));
        };
        document.head.appendChild(s);
    });
    return jsQrPromise;
}

// Extrae el número de parada del contenido del QR. El QR de la EMT es una URL
// tipo https://www.emtmadrid.es/PMVVisor/pmv.aspx?stopnum=2677&size=3
export function parseStopIdFromQr(text) {
    if (!text) return null;

    // 1) URL con parámetro stopnum / stop / parada
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

    // 2) patrón stopnum=NNNN / parada=NNNN en texto suelto
    const m =
        text.match(/stop(?:num)?=(\d+)/i) ||
        text.match(/parada[=/](\d+)/i);
    if (m) return parseInt(m[1], 10);

    // 3) primer número de hasta 5 dígitos como último recurso
    const n = text.match(/\b(\d{1,5})\b/);
    if (n) return parseInt(n[1], 10);

    return null;
}

// Abre el modal de cámara y resuelve con el número de parada escaneado, o null
// si el usuario cancela / no se pudo escanear.
export function openQrScanner() {
    return new Promise((resolve) => {
        let stream = null;
        let rafId = null;
        let settled = false;
        let detector = null;
        let canvas = null;
        let ctx = null;

        const overlay = document.createElement("div");
        overlay.className = "scanner-overlay";
        overlay.innerHTML = `
            <div class="scanner-modal" role="dialog" aria-modal="true" aria-label="Escanear QR de la parada">
                <div class="scanner-header">
                    <div class="scanner-title">Escanea el QR de la parada</div>
                    <button type="button" class="scanner-close" aria-label="Cerrar">✕</button>
                </div>
                <div class="scanner-video-wrap">
                    <video class="scanner-video" playsinline webkit-playsinline muted autoplay></video>
                    <div class="scanner-frame"></div>
                </div>
                <div class="scanner-status">Apunta la cámara al código QR de la marquesina.</div>
            </div>
        `;

        const video = overlay.querySelector(".scanner-video");
        const statusEl = overlay.querySelector(".scanner-status");
        const closeBtn = overlay.querySelector(".scanner-close");

        const cleanup = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = null;
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
                stream = null;
            }
            document.removeEventListener("keydown", onKey);
            overlay.classList.remove("scanner-visible");
            setTimeout(() => overlay.remove(), 150);
        };

        const finish = (result) => {
            if (settled) return;
            settled = true;
            cleanup();
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

        const handleText = (text) => {
            const stopId = parseStopIdFromQr(text);
            if (stopId != null) {
                finish(stopId);
            } else {
                statusEl.textContent = "QR leído pero sin número de parada reconocible.";
            }
        };

        // Bucle de detección con BarcodeDetector nativo
        const scanWithDetector = async () => {
            if (settled) return;
            try {
                const codes = await detector.detect(video);
                if (codes && codes.length) {
                    handleText(codes[0].rawValue);
                    if (settled) return;
                }
            } catch {
                /* algunos frames fallan, seguimos */
            }
            rafId = requestAnimationFrame(scanWithDetector);
        };

        // Bucle de detección con jsQR (canvas)
        const scanWithJsQr = (jsQR) => {
            if (settled) return;
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (w && h) {
                if (!canvas) {
                    canvas = document.createElement("canvas");
                    ctx = canvas.getContext("2d", { willReadFrequently: true });
                }
                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(video, 0, 0, w, h);
                const imageData = ctx.getImageData(0, 0, w, h);
                const code = jsQR(imageData.data, w, h);
                if (code && code.data) {
                    handleText(code.data);
                    if (settled) return;
                }
            }
            rafId = requestAnimationFrame(() => scanWithJsQr(jsQR));
        };

        const startDecoding = async () => {
            if ("BarcodeDetector" in window) {
                try {
                    detector = new window.BarcodeDetector({ formats: ["qr_code"] });
                    scanWithDetector();
                    return;
                } catch {
                    /* construirá falla → caemos a jsQR */
                }
            }
            try {
                statusEl.textContent = "Preparando el lector…";
                const jsQR = await loadJsQR();
                statusEl.textContent = "Apunta la cámara al código QR de la marquesina.";
                scanWithJsQr(jsQR);
            } catch (err) {
                statusEl.textContent = err.message || "No se pudo iniciar el lector de QR.";
            }
        };

        const start = async () => {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                statusEl.textContent = "Este dispositivo no permite usar la cámara.";
                return;
            }
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: "environment" } },
                    audio: false
                });

                // Safari/iOS: estos flags deben ir como PROPIEDADES (no solo
                // atributos HTML) o el vídeo se queda en negro aunque la cámara
                // esté activa. Y hay que esperar a los metadatos antes de play().
                video.setAttribute("playsinline", "");
                video.setAttribute("webkit-playsinline", "");
                video.setAttribute("autoplay", "");
                video.muted = true;
                video.playsInline = true;
                video.srcObject = stream;

                await new Promise((res) => {
                    if (video.readyState >= 1) return res();
                    video.onloadedmetadata = () => res();
                });

                try {
                    await video.play();
                } catch (e) {
                    // Algunos navegadores resuelven el play más tarde; seguimos.
                    console.warn("video.play() no resolvió de inmediato", e);
                }

                startDecoding();
            } catch (err) {
                console.warn("Cámara no disponible", err);
                statusEl.textContent =
                    err && err.name === "NotAllowedError"
                        ? "Permiso de cámara denegado. Actívalo para escanear."
                        : "No se pudo acceder a la cámara.";
            }
        };

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add("scanner-visible"));
        start();
    });
}
