# Diagnóstico del Asistente IA en Azure

## 1. Distinguir los tres niveles

El asistente depende de: (1) NestJS, (2) la resolución del tenant y PostgreSQL, y (3) FastAPI con Groq/Gemini. Que exista `GROQ_API_KEY` o `GEMINI_API_KEY` en Azure no prueba que el tráfico esté llegando al proveedor.

## 2. Pruebas desde PowerShell

Sustituye el dominio si tu web tiene otro hostname:

```powershell
$base = "https://fashionstore-web-4edbf7.orangerock-f50972dc.chilecentral.azurecontainerapps.io"
curl.exe -i "$base/api/health/live"
curl.exe -i "$base/api/health"
curl.exe -i -H "X-Tenant-Slug: legacy" "$base/api/ia/estado"
curl.exe -i -H "X-Tenant-Slug: legacy" "$base/api/ia/estado?probar=true"
```

Interpretación:

- `/api/health/live` debe responder HTTP 200 si el proceso NestJS está activo; no consulta PostgreSQL.
- `/api/health` valida la disponibilidad real de PostgreSQL y el rol `app_readonly`. Debe responder HTTP 200 y `estado: ok`; si no, devuelve HTTP 503 con `diagnostico` (por ejemplo `DATABASE_URL_REQUIRED`, `DATABASE_SSL_REQUIRED`, `28P01`, `42501`, `ECONNREFUSED` o `ENOTFOUND`).
- `/api/ia/estado` debe mostrar `proxy: nestjs` y proveedor `groq` o `gemini`. `local_rules` indica que se está usando el respaldo local.
- `/api/ia/estado?probar=true` ejecuta una prueba real por cada proveedor configurado. `pruebas[].ok=true` significa que esa clave y el modelo pudieron responder; si es `false`, revisa el mensaje `error` sin compartir la clave.
- `TENANT_RESOLUTION_FAILED`/HTTP 503 indica un error resolviendo `legacy` en PostgreSQL antes de llamar a FastAPI. No es un error de la clave de IA.
- `FASTAPI_NO_DISPONIBLE` indica que NestJS sí resolvió el tenant, pero no pudo completar la llamada al microservicio IA.

## 3. Variables de Azure Container Apps

En la Container App de NestJS (`fashionstore-api`):

- `DATABASE_URL`: URL válida de PostgreSQL/Neon, con TLS requerido para base remota.
- `FASTAPI_URL`: URL HTTPS pública de la Container App FastAPI, sin `/api` ni barra final.
- `IA_INTERNAL_KEY`: referencia al secreto compartido `ia-key`.

En la Container App FastAPI (`fashionstore-ai`):

- `DATABASE_URL`: la misma base de FashionStore.
- `IA_INTERNAL_KEY`: referencia al mismo secreto `ia-key` que NestJS.
- `GROQ_API_KEY`: referencia a un secreto que contiene una clave Groq válida (prefijo `gsk_`).
- `GEMINI_API_KEY`: referencia a un secreto que contiene una clave Gemini válida (`AIza...` o `AQ...`, según la clave emitida).
- `APP_ENV=production`.

No pegues valores secretos en GitHub, issues, capturas ni mensajes. Comprueba los nombres y las referencias, no el contenido. Tras cambiar secretos/variables, crea una revisión nueva y verifica que esté activa.

## 4. Ver logs de NestJS

Con Azure CLI y la suscripción correcta:

```powershell
az containerapp logs show --name fashionstore-api --resource-group NOMBRE_DEL_RESOURCE_GROUP --follow
```

Usa el nombre real de la Container App y del Resource Group de tu despliegue. Busca errores de PostgreSQL como `28P01` (autenticación), `3D000` (base inexistente), `42501` (permisos) o errores de TLS/conexión. No compartas líneas que contengan credenciales o cadenas de conexión.

## 5. Importante

El modo local es un respaldo de seguridad; no equivale a Groq/Gemini. Primero debe responder bien el endpoint `/api/health`, luego debe resolverse el tenant `legacy`, después NestJS debe llegar a FastAPI y finalmente la prueba de proveedor debe dar `ok: true`.

## 6. Orden de publicación y despliegue

1. Primero debe pasar el workflow CI (incluye `npm run build` de NestJS).
2. Después publica las imágenes con `Publish FashionStore images to GHCR`.
3. Solo cuando GHCR termine correctamente, actualiza las Container Apps de NestJS y FastAPI a las etiquetas nuevas; publicar imágenes no cambia por sí solo la revisión activa de Azure.
4. Confirma `/api/health/live` (proceso), luego `/api/health` (PostgreSQL), luego `/api/ia/estado` y finalmente `/api/ia/estado?probar=true`.
