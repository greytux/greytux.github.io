# Proxy EMT (Cloudflare Worker)

Pasarela que autentica contra la API de EMT Madrid y reenvía las peticiones,
manteniendo las credenciales como **secretos del servidor**. Así la PWA no
expone ningún email/contraseña.

## Endpoints

- `GET /api/arrives/:stopId` — llegadas en tiempo real
- `GET /api/detail/:stopId?v=1|2` — detalle de parada (coords + líneas)
- `GET /api/nearby/:lon/:lat/:radius` — paradas cercanas

Cada uno devuelve el mismo JSON que devolvía EMT directamente.

## Desplegar (una vez)

Necesitas una cuenta (gratis) de Cloudflare.

```bash
# 1. Instalar wrangler (CLI de Cloudflare)
npm install -g wrangler        # o: scoop install cloudflare-wrangler

# 2. Iniciar sesión en Cloudflare
wrangler login

# 3. Desde esta carpeta (worker/), guardar las credenciales como secretos
wrangler secret put EMT_EMAIL       # pega tu email de MobilityLabs
wrangler secret put EMT_PASSWORD    # pega tu contraseña

# 4. Desplegar
wrangler deploy
```

Al desplegar te dará una URL tipo:

```
https://turrobuses-emt.<tu-subdominio>.workers.dev
```

Copia esa URL y ponla en `js/apiEmt.js` (constante `PROXY_BASE`).

## Notas

- Las credenciales solo viven en los secretos del Worker (cifrados en
  Cloudflare). No están en este repo ni en el navegador.
- El proxy solo acepta peticiones desde los orígenes de `ALLOWED_ORIGINS`
  (edítalo en `emt-proxy.js` si cambias de dominio).
- El token de EMT se cachea en el Worker para no hacer login en cada llamada.
