# CLAUDE.md — Turrobuses

PWA (JS vanilla, módulos ES, sin build) de llegadas en tiempo real de la EMT de
Madrid. Las llamadas a EMT pasan por un **Cloudflare Worker** (`worker/`) que
guarda las credenciales como secretos. Cliente sin credenciales.

## Convenciones del proyecto

- Sin framework ni bundler. Módulos ES en `js/`, servidos tal cual por GitHub
  Pages desde `main`.
- Estado y persistencia en `localStorage` (ver `js/state.js`).
- Al cambiar archivos del shell, subir `CACHE_VERSION` en `sw.js` (el SW avisa
  de "nueva versión"; el cliente debe cerrar la PWA del todo para coger el SW
  nuevo, no basta recargar).
- Cambios en `worker/` requieren `wrangler deploy` aparte (no se despliegan con
  Pages).
- Idioma de UI y comentarios: español.

## API de EMT Madrid (MobilityLabs)

- **Docs (apiDoc):** https://apidocs.emtmadrid.es/
- **Datos crudos de la doc:** https://apidocs.emtmadrid.es/api_data.json
  (52 endpoints; útil para sacar parámetros/ejemplos sin adivinar esquemas)
- **Portal / registro de apps:** https://mobilitylabs.emtmadrid.es/
- Auth: `GET v?/mobilitylabs/user/login/` con cabeceras `email` + `password`
  (o `X-ClientId`/`passKey`); devuelve `accessToken`. El resto de llamadas
  llevan cabecera `accessToken`. Respuestas: `code "00"` = OK; `01/02` = token
  inválido; `81` = sin registros.

### Endpoints de bus (Block_3_TRANSPORT_BUSEMTMAD) — los que importan

| Método | Endpoint | Uso |
|---|---|---|
| POST | `v2/.../stops/<stopId>/arrives/` (opc. `/<lineArrive>/`) | Llegadas en tiempo real (filtrable por línea en servidor) |
| GET  | `v1/.../stops/<stopId>/detail/` | Detalle de parada (coords + líneas) |
| GET  | `v2/.../stops/arroundxy/<lon>/<lat>/<radius>/` | Paradas cercanas |
| GET  | `v2/.../stops/arroundstop/<stopId>/<radius>/` | Paradas cerca de una parada |
| GET  | `v1/.../lines/incidents/<lineid>/` (`all` = todas) | **Incidencias/avisos de línea** |
| GET  | `v1/.../lines/<labelId>/route/` | Recorrido de la línea (para dibujar en mapa) |
| GET  | `v1/.../lines/<lineId>/stops/<direction>/` | Paradas de una línea |
| GET  | `v1/.../lines/<lineId>/timetable/` | Horarios inicio/fin |
| GET  | `v1/.../lines/<lineId>/trips/<dateRef>/` | Expediciones (horarios) |
| GET  | `v1/.../lines/<lineId>/info/<dateref>/` | Info de línea (detalle) |
| GET  | `v1/.../calendar/<startdate>/<enddate>/` | Tipo de día (laborable/festivo) |
| POST | `v1/.../stops/list/` | Info de varias paradas |

Otros bloques disponibles (no usados): BiciMAD, parkings, CityMAD (POIs),
colecciones de datos genéricas, push.

### Notas de esquemas (observadas en la práctica)

- `arrives`: `data[0].Arrive[]` con `{ line, destination, estimateArrive (seg),
  DistanceBus, bus }`. A veces `data[0].StopInfo[0].geometry.coordinates`
  [lon,lat] trae las coords cuando `detail` no las da (p.ej. parada 2677).
- `detail`: la parada puede venir en `data[0].stops[0]`, `data[0].Stops[0]` o
  `data[0]` directamente; coords en `geometry.coordinates` [lon,lat] o
  `latitude`/`longitude` planos. Líneas en `dataLine[].label|line` o `lines[]`.
- `arroundxy`: paradas en `data[0].stops` (o `Stops`/`Stop`); líneas servidas en
  `lines[]` (puede ser array de objetos `{line,label}` o strings).
- `incidents`: `data[0].item[]` con `{ category:[lineas], title, description
  (HTML), pubDate, rssAfectaDesde, rssAfectaHasta, link (PDF) }`.

## Proxy (worker/emt-proxy.js)

Endpoints expuestos al cliente (devuelven el JSON de EMT tal cual, con CORS):
`/api/arrives/:stopId`, `/api/detail/:stopId?v=1|2`,
`/api/nearby/:lon/:lat/:radius`, `/api/incidents`.
Cachea respuestas correctas (Cache API) y el token. Solo acepta orígenes de
`ALLOWED_ORIGINS`.
