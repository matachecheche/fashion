# Asistente generativo en Azure — versión 2.3.0

## Qué corrige esta versión

- Las preguntas conversacionales de catálogo (por ejemplo, «muéstrame productos»), recomendaciones de estilo y análisis se envían a Groq/Gemini con el contexto de catálogo y stock leído para el tenant actual.
- Los conteos exactos y los listados operativos que necesitan autorización continúan siendo deterministas. Esto evita que el modelo invente cifras o consulte registros no permitidos.
- Se refuerza el prompt como asesor de moda y consultor de boutique: recomendaciones justificadas, comparaciones de productos disponibles, separación entre hechos verificados e interpretación, y sin inventar precios, tallas ni stock.
- Se priorizan Groq `openai/gpt-oss-120b` (razonamiento `high`) y Gemini `gemini-3.8-flash` cuando cada clave tiene esos modelos habilitados. Se descubren los modelos disponibles desde la API del proveedor y se prueban alternativas si el modelo preferido no está habilitado.
- El timeout generativo se amplía para permitir respuestas más elaboradas. Si fallan los proveedores, la respuesta de respaldo identifica la causa sin revelar claves.
- El saludo inicial de la web ya no etiqueta falsamente el motor como `local_rules`. Web y Android muestran proveedor, modelo y diagnóstico cuando existe una respuesta real.

La calidad final depende de la clave activa, los permisos/cuotas del proveedor y la calidad de los datos de la tienda. Tener una clave configurada no prueba que sea válida: hay que ejecutar la prueba de proveedor.

## Arquitectura requerida

```text
Web / Android
    -> Nginx same-origin /api
    -> NestJS (fashionstore-api)
    -> FastAPI (fashionstore-ai)
    -> Groq y/o Gemini
```

NestJS consulta los datos autorizados de PostgreSQL y entrega ese contexto a FastAPI. El frontend no debe llamar Groq/Gemini directamente ni almacenar claves.

## Variables que deben existir en Azure

### Container App `fashionstore-ai` (FastAPI)

- `DATABASE_URL`: referencia al secreto PostgreSQL/Neon.
- `IA_INTERNAL_KEY`: referencia al secreto de comunicación entre servicios.
- `GROQ_API_KEY`: referencia al secreto de Groq, si se utiliza.
- `GEMINI_API_KEY`: referencia al secreto de Google Gemini, si se utiliza.
- `APP_ENV=production`.
- `DATABASE_SSL=true`.

Se pueden configurar Groq y Gemini simultáneamente. La clave no debe estar en Git, en `VITE_*`, ni en el APK.

### Container App `fashionstore-api` (NestJS)

- `DATABASE_URL`: referencia al mismo PostgreSQL/Neon.
- `IA_INTERNAL_KEY`: debe resolver al mismo valor secreto que FastAPI.
- `FASTAPI_URL`: FQDN HTTPS de `fashionstore-ai`, sin `/api` y sin ruta final adicional.

### Container App `fashionstore-web` (Nginx)

- `API_UPSTREAM`: FQDN HTTPS de `fashionstore-api`.
- La aplicación web usa `/api`; Nginx enruta esa ruta al backend.

No se deben copiar valores secretos a capturas, chats, archivos `.env` versionados o logs.

## Publicar y desplegar la versión nueva

Un CI verde comprueba que el código compila y que pasan pruebas. **No actualiza por sí solo las Container Apps de Azure.** Para que Azure ejecute esta versión:

1. Hacer commit y `git push` de la versión 2.3.0.
2. En GitHub Actions, comprobar `CI — FashionStore`.
3. Ejecutar (o verificar que se haya ejecutado) `Publish public FashionStore images to GHCR`. Este workflow publica:
   - `ghcr.io/matachecheche/fashionstore-ai:latest` y `:sha-<commit>`
   - `ghcr.io/matachecheche/fashionstore-api:latest` y `:sha-<commit>`
   - `ghcr.io/matachecheche/fashionstore-web:latest` y `:sha-<commit>`
4. En Azure Portal, abrir **Container Apps** y actualizar las imágenes de las aplicaciones `fashionstore-ai`, `fashionstore-api` y `fashionstore-web` (los nombres reales pueden tener sufijo). Elegir el tag `sha-<commit>` publicado por el workflow, guardar y esperar a que la nueva revisión figure como **Provisioned/Running** y reciba tráfico.
5. Comprobar que las variables/secret references de la revisión nueva siguen apuntando a los secretos correctos. En particular, `IA_INTERNAL_KEY` debe ser la misma en NestJS y FastAPI.

Actualizar la imagen de un Container App es lo que crea una nueva revisión; las imágenes publicadas en GHCR no cambian automáticamente una revisión de Azure.

## Diagnóstico desde PowerShell

Sustituye el dominio si tu URL pública cambia:

```powershell
$base = "https://fashionstore-web-4edbf7.orangerock-f50972dc.chilecentral.azurecontainerapps.io"

# Proceso NestJS vivo (no prueba PostgreSQL)
curl.exe -i "$base/api/health/live"

# Preparación de la API + PostgreSQL
curl.exe -i "$base/api/health"

# Configuración detectada del asistente
curl.exe -i -H "X-Tenant-Slug: legacy" "$base/api/ia/estado"

# Prueba una generación real en cada proveedor configurado
curl.exe -i -H "X-Tenant-Slug: legacy" "$base/api/ia/estado?probar=true"
```

Interpretación de diagnósticos seguros:

- `LLM_KEYS_NOT_CONFIGURED`: FastAPI no recibió `GROQ_API_KEY` ni `GEMINI_API_KEY` en esa revisión.
- `LLM_PROVIDERS_FAILED`: recibió una o más claves, pero la llamada generativa falló. Revisar el texto de error sanitizado devuelto por la prueba de proveedor, cuota, permisos y modelos habilitados.
- `FASTAPI_INTERNAL_KEY_REJECTED`: `IA_INTERNAL_KEY` de NestJS y FastAPI no coincide o falta una referencia.
- `FASTAPI_NETWORK_ENOTFOUND` / `FASTAPI_NETWORK_ECONNREFUSED`: `FASTAPI_URL` incorrecto o servicio inaccesible.
- `FASTAPI_TIMEOUT`: revisar cold start, cuota o latencia del proveedor.
- HTTP 503 en `/api/health`: proceso activo, pero NestJS no consigue preparar PostgreSQL o sus permisos. No es un problema de la clave Groq/Gemini.

`/api/ia/estado?probar=true` llama realmente al proveedor, pero no realiza una conversación con contexto del catálogo. La prueba funcional final es abrir el asistente en la web y preguntar «muéstrame productos disponibles»; debe identificar proveedor y modelo, y basar nombres/precios/stock en el contexto de esa tienda.
