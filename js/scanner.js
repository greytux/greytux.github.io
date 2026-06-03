// scanner.js — escanear el QR de una parada EMT con la cámara.
//
// En vez de vídeo en vivo (getUserMedia), que en Safari/iOS-PWA suele dar
// preview en negro, usamos el "modo foto" nativo: <input type="file" capture>.
// El sistema abre su cámara, el usuario hace una foto y decodificamos la imagen
// con BarcodeDetector (si existe) o jsQR como respaldo. Fiable en iPhone y
// Android por igual.

import { toast } from "./toast.js";

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

// Carga el File como algo dibujable en canvas (ImageBitmap o <img>).
async function fileToDrawable(file) {
    if ("createImageBitmap" in window) {
        try {
            return await createImageBitmap(file);
        } catch {
            /* algunos formatos/Safari fallan: caemos a <img> */
        }
    }
    return await new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
}

// Decodifica el QR de una imagen y devuelve el número de parada o null.
async function decodeStopFromFile(file) {
    const src = await fileToDrawable(file);
    const w = src.width || src.naturalWidth;
    const h = src.height || src.naturalHeight;
    if (!w || !h) return null;

    // 1) BarcodeDetector nativo (Android/Chrome): admite directamente la imagen
    if ("BarcodeDetector" in window) {
        try {
            const det = new window.BarcodeDetector({ formats: ["qr_code"] });
            const codes = await det.detect(src);
            if (codes && codes.length) {
                return parseStopIdFromQr(codes[0].rawValue);
            }
        } catch {
            /* seguimos con jsQR */
        }
    }

    // 2) jsQR sobre los píxeles del canvas
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);

    const jsQR = await loadJsQR();
    const code = jsQR(imageData.data, w, h);
    return code && code.data ? parseStopIdFromQr(code.data) : null;
}

// Abre la cámara en modo foto y resuelve con el número de parada, o null.
export function openQrScanner() {
    return new Promise((resolve) => {
        let settled = false;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.capture = "environment"; // cámara trasera directa
        input.style.display = "none";
        document.body.appendChild(input);

        const finish = (result) => {
            if (settled) return;
            settled = true;
            window.removeEventListener("focus", onFocusBack);
            input.remove();
            resolve(result);
        };

        // Los <input file> no avisan al cancelar. Si vuelve el foco a la página
        // y no hay archivo, asumimos cancelación.
        const onFocusBack = () => {
            setTimeout(() => {
                if (!input.files || !input.files.length) finish(null);
            }, 600);
        };

        input.addEventListener("change", async () => {
            const file = input.files && input.files[0];
            if (!file) return finish(null);
            try {
                const stopId = await decodeStopFromFile(file);
                if (stopId == null) {
                    toast(
                        "No se ha podido leer el QR. Acércate y enfoca bien el código.",
                        { type: "error", duration: 5000 }
                    );
                }
                finish(stopId);
            } catch (err) {
                console.warn("Error decodificando QR", err);
                toast("No se pudo procesar la foto del QR.", { type: "error" });
                finish(null);
            }
        });

        window.addEventListener("focus", onFocusBack);
        input.click();
    });
}
