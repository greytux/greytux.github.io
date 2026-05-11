// walkTime.js — estimación de tiempo andando hasta una parada y veredicto
// "¿llego al bus?" comparando con la ETA del próximo.

const EARTH_RADIUS_M = 6371000;
// 4.86 km/h, ritmo urbano sostenido (no carrera). Razonable de media.
const WALK_SPEED_M_S = 1.35;
// Las calles no son rectas: añadir un 30% sobre la distancia en línea recta.
const STREET_FACTOR = 1.3;
// Cruces, semáforos, encontrar la parada: tiempo fijo extra.
const OVERHEAD_S = 20;
// Por encima de esto el "andando" no es realista — el usuario querrá otra
// parada o medio de transporte. Mostramos tiempo sin veredicto.
const MAX_REALISTIC_WALK_M = 1500;

function haversineMeters(lat1, lon1, lat2, lon2) {
    const toRad = d => (d * Math.PI) / 180;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a =
        Math.sin(Δφ / 2) ** 2 +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function estimateWalk({ userLat, userLon, stopLat, stopLon }) {
    const straightM = haversineMeters(userLat, userLon, stopLat, stopLon);
    const walkM = straightM * STREET_FACTOR;
    const walkSec = Math.round(walkM / WALK_SPEED_M_S + OVERHEAD_S);
    return {
        walkSec,
        walkM: Math.round(walkM),
        straightM: Math.round(straightM),
        realistic: straightM <= MAX_REALISTIC_WALK_M
    };
}

// busSecs: array de ETAs en segundos, ordenado ascendente.
// Devuelve un veredicto o null si no se puede decidir.
export function computeVerdict({ walkSec, busSecs }) {
    if (!Array.isArray(busSecs) || busSecs.length === 0 || walkSec == null) {
        return null;
    }

    const firstBus = busSecs[0];
    const firstMargin = firstBus - walkSec;

    if (firstMargin >= 180) {
        return {
            kind: "comfortable",
            text: "Llegas con margen",
            marginSec: firstMargin
        };
    }
    if (firstMargin >= 60) {
        return {
            kind: "tight",
            text: "Justo, anda rápido",
            marginSec: firstMargin
        };
    }
    if (firstMargin >= 0) {
        return {
            kind: "urgent",
            text: "¡Corre, lo coges!",
            marginSec: firstMargin
        };
    }

    // No llegas al primero. ¿Te da tiempo al siguiente?
    if (busSecs.length >= 2) {
        const secondBus = busSecs[1];
        const secondMargin = secondBus - walkSec;
        if (secondMargin >= 60) {
            const minTilSecond = Math.round(secondBus / 60);
            return {
                kind: "miss-catch-next",
                text: `No llegas al primero, pero al siguiente sí (~${minTilSecond} min)`,
                marginSec: secondMargin
            };
        }
    }

    return {
        kind: "miss",
        text: "No llegas a tiempo",
        marginSec: firstMargin
    };
}
