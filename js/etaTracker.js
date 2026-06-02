// etaTracker.js — detectar buses retrasados comparando ETA esperada vs real.
//
// EMT publica una ETA en segundos que debería decrementar 1 a 1 con el tiempo
// real transcurrido. Si la ETA decrece menos de lo que pasa el reloj, el bus
// va más lento de lo previsto: lleva retraso. Acumulamos primera ETA + primer
// timestamp por bus y comparamos contra la ETA actual.
//
// El tracker vive solo en memoria — un retraso detectado no necesita persistir
// entre cargas, son segundos de vida.

const tracker = new Map();
const STALE_MS = 30 * 60 * 1000; // limpiar entradas no vistas hace 30 min
const MIN_TRACK_SEC = 90;        // mínimo tiempo de tracking antes de decidir
const SLIP_THRESHOLD_SEC = 60;   // a partir de 1 min de slip lo consideramos retraso

function busKey(stopId, arrival) {
    // EMT a veces devuelve `bus` (id de vehículo). Sin él no podemos seguir
    // un bus concreto a lo largo de varios ticks (line+destination no es único
    // porque pueden venir dos buses de la misma línea seguidos).
    if (!arrival.bus) return null;
    return `${stopId}:${arrival.bus}`;
}

function cleanupStale(now) {
    for (const [key, val] of tracker) {
        if (now - val.lastSeen > STALE_MS) tracker.delete(key);
    }
}

export function trackArrivals(stopId, arrivals) {
    if (!Array.isArray(arrivals)) return;
    const now = Date.now();
    cleanupStale(now);

    arrivals.forEach(a => {
        if (a.estimateArrive == null) return;
        const key = busKey(stopId, a);
        if (!key) return;

        const existing = tracker.get(key);
        if (!existing) {
            tracker.set(key, {
                firstEta: a.estimateArrive,
                firstSeen: now,
                lastEta: a.estimateArrive,
                lastSeen: now
            });
        } else {
            existing.lastEta = a.estimateArrive;
            existing.lastSeen = now;
        }
    });
}

export function getDelayInfo(stopId, arrival) {
    if (!arrival || arrival.estimateArrive == null) return null;
    const key = busKey(stopId, arrival);
    if (!key) return null;
    const t = tracker.get(key);
    if (!t) return null;

    const elapsedSec = (t.lastSeen - t.firstSeen) / 1000;
    if (elapsedSec < MIN_TRACK_SEC) return null;

    const etaDropSec = t.firstEta - t.lastEta;
    // Slip = cuánto tiempo de más ha tardado el bus respecto a lo que predecía
    // su propia ETA inicial.
    const slipSec = elapsedSec - etaDropSec;

    if (slipSec < SLIP_THRESHOLD_SEC) return null;

    return {
        slipSec: Math.round(slipSec),
        slipMin: Math.round(slipSec / 60),
        severity: slipSec >= 180 ? "high" : "low" // >3 min de retraso = serio
    };
}
