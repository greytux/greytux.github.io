# 🐶🚌 Turrobuses

Llegadas en tiempo real de los autobuses de la **EMT de Madrid**, en una PWA
rápida, instalable y sin distracciones.

**▶️ En vivo:** https://greytux.github.io/

> Alternativa ligera a la app oficial: carga al instante, funciona offline (la
> cáscara), sin anuncios y sin tracking.

---

## ✨ Funcionalidades

- **⭐ Paradas favoritas** persistidas en el navegador: añadir, quitar, reordenar
  y fijar su ubicación a mano cuando la API no la expone.
- **🔎 Filtro por línea en vivo** en favoritas y en paradas cercanas: oculta lo
  que no tiene esa línea y evita peticiones innecesarias.
- **🚶 "¿Llego?"** — compara el tiempo andando hasta la parada (distancia +
  ritmo) con la llegada del bus y te dice si llegas, si vas justo o si corres.
- **⏰ Detector de retrasos** — sigue la evolución de cada ETA y marca los buses
  que van más lentos de lo previsto.
- **🔔 Alarmas por línea** — "avísame cuando el 137 esté a ≤ 5 min": notificación
  del sistema + aviso en pantalla + vibración.
- **📍 Paradas cercanas** por geolocalización.
- **🗺️ Mapa** (Leaflet + OpenStreetMap) con todas tus paradas y tu ubicación.
- **📷 Escáner QR** — escanea el código de la marquesina y añade la parada.
- **🏠🏢 Atajos** Casa/Trabajo, accesibles incluso desde el icono de la PWA
  instalada (manifest shortcuts) y por URL (`?parada=NNNN`, `?atajo=casa`).
- **📲 PWA instalable**, con aviso de "nueva versión disponible" y cáscara
  cacheada para arranque instantáneo / offline.

---

## 🧱 Arquitectura

JavaScript **vanilla con módulos ES**, sin framework ni paso de build. El estado
vive en `localStorage`; los datos en tiempo real llegan de la API de EMT a
través de un **proxy serverless** que mantiene las credenciales fuera del
cliente.

```
greytux/
├── index.html              # estructura + pestañas
├── styles.css              # estilos
├── manifest.webmanifest    # PWA (iconos, shortcuts)
├── sw.js                   # service worker (cáscara offline + aviso de versión)
├── icons/                  # iconos PWA
├── js/
│   ├── main.js             # orquestación, polling, registro del SW
│   ├── state.js            # estado + persistencia (favoritas, alarmas, atajos…)
│   ├── apiEmt.js           # cliente del proxy EMT (sin credenciales)
│   ├── uiStops.js          # render de paradas, favoritas, cercanas, "¿llego?"
│   ├── alarms.js           # alarmas por línea + notificaciones
│   ├── etaTracker.js       # detección de retrasos
│   ├── walkTime.js         # cálculo andando vs ETA
│   ├── map.js              # mapa Leaflet
│   ├── coordPicker.js      # fijar ubicación de una parada a mano
│   ├── scanner.js          # escáner QR (html5-qrcode)
│   ├── shortcuts.js        # atajos Casa/Trabajo + URL params
│   ├── toast.js            # toasts + diálogos in-app
│   └── slider.js           # navegación por pestañas
└── worker/                 # proxy Cloudflare Worker (credenciales EMT seguras)
```

### Proxy de credenciales

La app **no contiene ninguna credencial**. Las peticiones a EMT pasan por un
**Cloudflare Worker** que:

- guarda el email/contraseña de MobilityLabs como **secretos del servidor**,
- hace login y cachea el token,
- cachea las respuestas (llegadas 15s, cercanas 30s, detalle 6h) para no agotar
  la cuota de la API,
- solo acepta peticiones desde el dominio de la app.

Detalles y despliegue: [`worker/README.md`](worker/README.md).

---

## 🛠️ Tecnologías

- HTML + CSS + **JavaScript vanilla (ES Modules)**, sin framework ni bundler
- **PWA**: Service Worker + Web App Manifest
- [Leaflet](https://leafletjs.com/) (mapa) · [html5-qrcode](https://github.com/mebjas/html5-qrcode) (escáner)
- **Cloudflare Workers** (proxy de API)
- **GitHub Pages** (hosting)
- API de [EMT Madrid MobilityLabs](https://mobilitylabs.emtmadrid.es/)

---

## 🚀 Desarrollo local

```bash
# Servir la cáscara estática (cualquier servidor estático vale)
python -m http.server 8000
# → http://localhost:8000
```

Notas:
- El **service worker** y la **cámara** requieren HTTPS o `localhost` (no funcionan
  por IP de red local).
- Para los datos de EMT necesitas el proxy desplegado y su URL en
  `js/apiEmt.js` (`PROXY_BASE`). Ver [`worker/README.md`](worker/README.md).

---

## 📋 Notas

Proyecto personal, sin afiliación con la EMT de Madrid. Los datos provienen de
su API pública de MobilityLabs.
