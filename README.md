# FashionStore — Plataforma comercial SaaS multi-tenant para moda

Solución completa para un negocio de ropa boliviano: **punto de venta (POS) + tienda online +
probador con realidad aumentada (AR) + IA de estilo/tallas + sincronización offline-first**,
construida como SaaS multi-tenant (varias tiendas en una sola instancia).

> Moneda: **BOB (Bs)**. Cobros: **modo SANDBOX** (sin dinero real) en esta entrega.
> Ningún cobro, facturación ni despacho aquí mueve dinero ni mercancía real.

## Qué incluye

| Capa | Tecnología | Puerto |
|------|------------|--------|
| Base de datos | PostgreSQL 17 (RLS + multi-tenant) | 5432 |
| API comercial | NestJS (Node 22+) | 3000 |
| IA / tallas / chat / AR overlays | FastAPI (Python 3.12) | 8000 |
| Frontend web (PWA) | React + Vite | 5173 |
| App móvil | Expo SDK 54 (React Native) | — |

## Inicio rápido

### Opción A — Docker (recomendada)

```bat
iniciar-docker.bat
```

Requiere Docker Desktop. Construye las 4 imágenes, aplica schema + migraciones + datos semilla
y espera a que la API esté sana antes de terminar. Abre **http://localhost:5173**.

### Opción B — Stack nativo (desarrollo sin Docker)

Requisitos: Python 3.10+, Node 22+, PostgreSQL 17 (con `psql` en el PATH y acceso de
superusuario `postgres` — ver “Contraseña de PostgreSQL en archivo” aquí abajo).

```bat
iniciar.bat            :: auto: si Docker responde lo usa; si no, modo nativo
```

**MODO FÁBRICA en cada arranque:** se elimina TOTALMENTE la base `fashionstore` y se recrea
desde cero con schema + migraciones + **datos de ejemplo para todos los módulos**: ventas,
pagos, devoluciones, inventario, compras, POS, reservas, catálogo, propuestas, IA/ML, notificaciones,
auditoría, suscripción SaaS, sincronización y conflictos. El cliente web/móvil detecta la nueva
generación y borra también JWT, tenant, carrito y cachés locales para abrir `legacy` con los
nuevos ejemplos. **Los datos que crees entre arranques se pierden.**

- `resetear-demo.bat` también restaura la fábrica.
- `--keep-db` se conserva oculta únicamente para rechazarla: si se pasa, `iniciar.py` termina
  con un mensaje antes de arrancar Docker/nativo o tocar la base. Todo inicio normal es un reset,
  no una conservación.

### Revalidar el arreglo de Express en Windows

Primero aplica el `proyecto.zip` actualizado sobre la copia que contiene el `iniciar.bat`
que ejecutarás. En CMD, desde esa raíz, reinstala y verifica las dependencias en ESA copia:

```bat
cd /d "C:\ruta\a\fashionstore"
cd backend-nest
npm ci --legacy-peer-deps
node -p "require.resolve('express')"
node -p "require('express/package.json').version"
npm run build
cd ..
iniciar.bat
```

Se espera Express **5.3.0**. El inicializador también comprueba que Express y los paquetes
Nest sean realmente resolubles y repara dependencias aun si ya existe `node_modules`.
El arranque restaura la base de fábrica y sus ejemplos; no agregues `--keep-db`.

En modo nativo, `iniciar.py` crea/actualiza el rol `fs_app` (LOGIN, NOSUPERUSER) con una
contraseña local aleatoria en `builds/.fs_app_password` y usa `fs_app` en `DATABASE_URL`
si existe. Nunca commitea secretos.

### Contraseña de PostgreSQL en archivo (Windows / sin sudo)

En el primer arranque nativo, `iniciar.py` necesita la contraseña del superusuario
`postgres` para aplicar schema + migraciones + seed y levantar la app. Si no encuentra
ninguna fuente, la pide **UNA vez** con entrada oculta y la guarda en **`builds/.pg_password`**;
los arranques siguientes no preguntan nada.

Precedencia: `PGPASSWORD` (entorno) > `builds/.pg_password` > peer auth por `sudo -u postgres` (Linux).

- Cambiarla: edita la primera línea no comentada de `builds/.pg_password`.
- Que la vuelva a pedir: borra `builds/.pg_password`.
- Es un archivo **local**, fuera de git y de `proyecto.zip` (la carpeta `builds/` está ignorada).
  **No** es la contraseña de la app (esa la genera `iniciar.py` en `builds/.fs_app_password`).
- Si tu carpeta del proyecto vive dentro de OneDrive/Google Drive, ten en cuenta que ese
  archivo viajará con tu cuenta de la nube; si prefieres, usa `setx PGPASSWORD "tu_clave"`
  en su lugar (variable de entorno de Windows, con el `iniciar.py` original también funciona).

### PostgreSQL en español y bases de datos antiguas

- Con PostgreSQL instalado en **español**, los pies de página de `psql` son `«(1 fila)»`.
  `iniciar.py` usa `-tA`, así que el idioma ya no afecta la detección de la base.
- Si existe una base `fashionstore` creada por una copia **anterior** del proyecto, el
  arranque normal la elimina y la crea de nuevo con el esquema y seed actuales; no se
  aplican migraciones sobre datos antiguos.

### Puertos ocupados en el arranque (EADDRINUSE / WinError 10048)

Si ves `EADDRINUSE: address already in use 0.0.0.0:3000` o `[Errno 10048] ... ('0.0.0.0', 8000)` o
Vite reporta `Port 5173 is in use`, hay un FashionStore anterior (u otra app) corriendo.

1. Cierra la ventana de consola donde corre el stack anterior (o ejecuta `detener.bat`), **o**
2. Encuentra y mata el proceso por puerto (Windows):
   ```bat
   netstat -ano | findstr :3000
   taskkill /F /PID <pid>     (repite con :8000 y :5173)
   ```

`iniciar.bat` ahora **detecta los puertos ocupados ANTES de tocar nada** y te lo indica (la base
no se borra en ese caso).

### Opción C — Previsualización del build de producción (PWA real)

```bat
cd frontend-web
npm run build && npm run preview   :: http://localhost:4173
```

Sirve `dist/` con el mismo proxy que producción (`/api` y `/assets/prendas/` → NestJS).
**Único entorno donde se registra el Service Worker** (la PWA offline real se valida aquí).

### Opción D — Verificación completa

```bat
iniciar.bat     :: ventana 1
verificar.bat   :: ventana 2 — compila, typechecks y ejecuta tests (nada se despliega)
```

## Usuarios semilla (tenant `legacy`)

| Usuario | Rol | Contraseña |
|---------|-----|------------|
| admin@fashionstore.bo | Admin | `Fashion2026!` |
| encargado@fashionstore.bo | Encargado | `Fashion2026!` |
| cajero@fashionstore.bo | Cajera POS | `Fashion2026!` |
| proveedor@fashionstore.bo | Proveedor | `Fashion2026!` |
| cliente@fashionstore.bo | Cliente | `Fashion2026!` |

La tienda demo (`legacy`, "FashionStore Bolivia") trae catálogo, stock, promociones
y una caja POS abierta. Crear una tienda nueva es posible desde la web (**Onboarding**)
o con `POST /api/auth/registrar-tienda`.

## Mapa del repositorio

```
backend-nest/      API SaaS: auth JWT + tenant binding, catálogo, inventario,
                   ventas, reservas, POS, pagos (sandbox), reportes, sync offline,
                   suscripción, notificaciones, propuestas, usuarios.
backend-fastapi/   IA: chat local (rules) o Groq si GROQ_API_KEY, estimación de
                   talla (IMC), análisis ML y rutas demo de entrenamiento/predicción
                   persistente por tenant con datos sintéticos; 8 pytest + 6 IA pasan.
frontend-web/      PWA React: tienda online, checkout, pedidos, reservas, POS,
                   dashboard admin, asistente IA, offline, ventas y compensación sandbox.
mobile-app/        App Android/iOS (Expo SDK 54): tienda, probador AR, POS/panel,
                   dictado de reportes, sync/conflictos, transferencias de stock,
                   ayuda y onboarding; cola offline en SQLite.
database/          schema.sql + 8 migraciones (003–010) + seed.sql.
tools/             Generador de assets de prendas (tools/generar_prendas.py) y
                   verificadores de integridad y UI (tools/verificar_manifiesto.py,
                   tools/verificar_ui_sweep.py — requiere stack vivo, solo lectura).
docs/              VERIFICACION.md — evidencia histórica y resultados del último corte.
                   TRAZABILIDAD.md / AUDITORIA.md — matriz CU/T y evidencia pendiente del PDF.
                   ICONIX.md + uml/*.puml + uml/rendered/*.svg — modelos versionados (no reemplazan pruebas).
                   screenshots/ — evidencia visual histórica; el ZIP omite capturas grandes.
                   PROGRESO.md / DECISIONES.md — continuidad, decisiones y brechas abiertas.
tools/paquetizar_proyecto.py — genera `manifest.sha256` y `proyecto.zip` sin secretos/builds.
.github/workflows/ci.yml — CI definido; su ejecución debe revisarse en Actions.
```

## Crear y verificar el paquete descargable

Desde la raíz del repo, con Python 3:

```bash
python3 tools/paquetizar_proyecto.py
python3 tools/verificar_manifiesto.py --zip
```

En Windows puedes ejecutar `manifest.bat`. El generador crea `manifest.sha256` y `proyecto.zip` (raíz interna `fashionstore/`), excluye dependencias/builds, capturas pesadas y archivos con nombres/extensiones de credenciales. El verificador falla ante entradas fuera del manifiesto, rutas prohibidas o marcadores comunes de claves privadas/tokens/URLs de base con contraseña. Esto no sustituye una revisión de secretos: revisa los `.env.example` (placeholders) y configura credenciales reales fuera del repo/paquete antes de desplegar.

## Modelo de seguridad (resumen)

- **JWT con `tenant_id` embebido**: cada token está ligado a una tienda; en solicitudes autenticadas el servidor resuelve el tenant por el ID firmado del JWT y comprueba que el slug de ruta/header coincida. Ruta y header sirven para acceso público por slug (p. ej. catálogo/login); un `tenant_id` del cliente nunca selecciona el tenant.
- **PostgreSQL RLS**: el API abre cada transacción con `SET LOCAL ROLE app_runtime`
  (o `app_readonly`) + `set_config('app.tenant_id', ...)`. Las políticas filtran por tenant;
  el rol no tiene BYPASSRLS ni es superusuario.
- **Idempotencia offline**: toda venta/reserva de la cola móvil lleva `operacion_offline_id`
  (UUID/prefijo `OFF-*`). Misma clave + mismo contenido → replay idempotente (no duplica).
  Misma clave + contenido distinto → `409 IDEMPOTENCY_PAYLOAD_MISMATCH` / `rechazada`.
  Stock insuficiente al sincronizar → fila `conflicto` en `operaciones_offline` (revisar en POS).
- **Pagos**: el retorno del navegador no confirma una venta. `POST /ventas` con QR/tarjeta
  deja la venta en `pendiente_pago` hasta que se procesa el webhook firmado del proveedor.
  `aprobar-sandbox`/`rechazar-sandbox` son únicamente para el simulador de pruebas y quedan
  bloqueados para Stripe cuando Checkout test está configurado. `efectivo` en caja POS sí
  confirma al instante (solo roles caja/admin/encargado con `origen=pos|offline_pos`).

## Pagos en modo sandbox

`PAGOS_MODO=sandbox` por defecto. Las pasarelas de prueba (Libélula QR, Stripe test) no
cobran dinero real. El banco emisor y la autenticación 3DS los manejan las pasarelas,
nunca este software. Para usar cobros reales hay que contratar las pasarelas, rotar
credenciales por entorno y validar legalmente la tienda — nada de eso está automatizado aquí.

### Stripe Checkout alojado (solo test)

Para habilitar el formulario alojado por Stripe, configura **solo en el backend**
(`backend-nest/.env`, secretos de Docker o un gestor de secretos):

```dotenv
PAGOS_MODO=sandbox
STRIPE_SECRET_KEY=rk_test_...  # restricted key: Checkout Sessions Write; o sk_test_; nunca live
STRIPE_WEBHOOK_SECRET=whsec_... # el secreto del endpoint/Stripe CLI correspondiente
PUBLIC_API_URL=https://api.tu-dominio.example
```

El endpoint de webhook es `POST /api/pagos/webhooks/stripe-checkout`. En Stripe suscribe
los eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed` y `checkout.session.expired`. Para desarrollo
local, Stripe CLI puede reenviar eventos a `http://localhost:3000/api/pagos/webhooks/stripe-checkout`;
usa el `whsec_` emitido por esa sesión de CLI. En un despliegue, registra el endpoint HTTPS
público y usa su propio secreto. `PUBLIC_API_URL` debe ser accesible desde el navegador y,
en producción, usar HTTPS.

El navegador y la app móvil reciben únicamente una URL de Checkout; nunca deben recibir
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` ni `STRIPE_SIMULATOR_WEBHOOK_SECRET`. Este último
secreto pertenece solo al simulador sandbox, es distinto del `whsec_` de Stripe y el launcher
lo genera si falta o contiene un placeholder. La página de retorno no confirma pedidos: el backend solo procesa la orden después de
validar `Stripe-Signature` sobre el cuerpo original y conciliar tenant, sesión, referencia,
importe y moneda. Si Checkout no está configurado, el simulador existente se muestra
claramente como simulación y no valida tarjetas. `GET /api/pagos/config` indica si la
configuración tiene el formato necesario, pero no comprueba que la clave autentique ante
Stripe; confirma el funcionamiento con un evento firmado de prueba.

La disponibilidad de BOB depende de la cuenta/configuración de Stripe y no se ha validado
con credenciales de este proyecto. No se deben usar claves `sk_live_` ni `rk_live_` en este
flujo. Tras configurar los secretos, reconstruye/reinicia el backend y prueba en el dashboard
de Stripe en modo test.

Para el flujo asistido de despliegue de NestJS, FastAPI y la web en Container Apps con Neon,
ejecuta `desplegar-azure.bat` y consulta [`docs/DESPLIEGUE-AZURE.md`](docs/DESPLIEGUE-AZURE.md).
El BAT inicia sesión Azure si hace falta; el asistente abre Neon para que crees un proyecto nuevo y pide localmente la URL directa oculta. GHCR quedó confirmado como registro para `.github/workflows/publish-ghcr.yml`; antes de desplegar hay que publicar los tres paquetes y hacerlos públicos. El despliegue no crea ACR. El flujo ya está implementado, pero **no se ha ejecutado contra Azure/Neon reales** desde este entorno. ACA y el egress pueden generar cargos fuera de la asignación gratuita; no se garantiza costo cero.

## App móvil — compilar el APK

Requisitos reales: cuenta EAS (login con `eas login`), `eas init`, y la API publicada en
una URL HTTPS (Azure Container Apps, Render, ...). **No hay APK funcional sin esos pasos.**
Ver `mobile-app/BUILD-DEV-CLIENT.md` y `docs/APK.md` (lista de pasos y qué NO garantiza).

```bash
cd mobile-app
npm ci --legacy-peer-deps
npx tsc --noEmit
./build-apk.bat preview      # o: generar-apk-azure.bat https://tu-api.azurecontainerapps.io
```

## Estado de verificación más reciente

Fecha de corte: **2026-11-10**. El registro íntegro, con separación entre evidencia histórica y actual, está en `docs/VERIFICACION.md` §§20–24; §24 prevalece para el flujo de publicación GHCR/despliegue Azure.

**Última actualización (flujo asistido Azure/Neon):** `desplegar-azure.bat` inicia sesión Azure CLI si hace falta y lanza el asistente local; abre Neon para crear un proyecto nuevo, recibe su URL directa oculta, exige las migraciones `003`–`010` y aplica schema/migraciones/seed tras confirmación. GHCR fue confirmado como registry; GitHub Actions construye/publica las imágenes y el usuario debe poner cada paquete en visibilidad Public antes de que pase el pull anónimo. El despliegue no crea ACR, identidad ni Log Analytics. La web usa `/api` con proxy Nginx de API_UPSTREAM runtime. **No se ha ejecutado un despliegue Azure/Neon ni el workflow GHCR:** este entorno no tiene sesión Azure/Neon/GitHub. ACA y el egress pueden generar cargos fuera de la asignación gratuita; no se promete $0 total. Ver `docs/DESPLIEGUE-AZURE.md`.

**Ejecutado en esta ronda histórica:**

- PostgreSQL 17.11 temporal en loopback: DB recreada; `schema.sql`, migraciones 003–010 y seed aplicados; `schema_version=10`.
- NestJS (Node 22.23.4): build, `test:security`, `node --check test/*.mjs` y audit de producción OK (0 vulnerabilidades reportadas). `express` está declarado como dependencia runtime directa; `iniciar.py` comprueba resolución real con Node y repara dependencias aunque exista `node_modules`. El fallo Windows aún requiere revalidación en la copia actualizada; prueba con `iniciar.bat` (restaura fábrica y borra los datos previos).
- Stack NestJS + FastAPI + PostgreSQL limpio: **8/8 suites PASS** (`test:smoke`, `test:sync-conflicts`, `test:payments`, `test:subscription`, `test:sync`, `test:reportes`, `test:ia`, `test:ml-persistence`). Incluye regresiones de sagas, conflictos durables y persistencia ML tenant-scoped con datos sintéticos.
- Web: audit npm moderada sin vulnerabilidades reportadas, build Vite y `npm test` → `PWA OFFLINE TEST PASSED`.
- FastAPI: `pytest -q` **8 passed**, `tests/prueba_ia.py` **6 passed**, `pip-audit --strict` sin vulnerabilidades conocidas; un warning Starlette/httpx.
- Móvil (Expo SDK 54): typecheck, export Android, Expo Doctor **18/18**, prebuild Android y permisos de voz OK. El export Hermes de 2.13 MB **no es un APK**; `npm audit --audit-level=high` pasa con 13 avisos remanentes (1 low, 12 moderate).
- UML: cinco fuentes PlantUML validadas, renderizadas y sus SVG parsean como XML.

**Límites vigentes:**

- Las pruebas PostgreSQL usan un clúster temporal local; no hay Docker/Compose, instancia cloud ni auditoría exhaustiva de todas las políticas RLS/ownership. Los modelos ML son solo sintéticos.
- No hay prueba de concurrencia multi-dispositivo, voz en dispositivo, APK firmado/instalado, EAS, despliegue Azure/Neon ni pasarela real. No se ejecutaron GitHub Actions o `.bat` en Windows; el UI sweep 13/13 de §11 es histórico.
- Drive devolvió el candidato `INF432_SE2_GXX.zip` (5,076,155 bytes; 31-10-2026), pero el lector conectado no extrae ZIP y no se inspeccionó. Los criterios normativos CU-01–CU-21, D1–D9 y T-01–T-20 siguen sin verificación; **el proyecto no se declara terminado**.

La prueba de integración de ML persiste artefactos y predicciones demo en PostgreSQL, pero no representa entrenamiento ni decisiones comerciales con datos reales. Los pagos/devoluciones/cambios de plan siguen en sandbox y no mueven fondos.


## Licencia y honestidad

Proyecto de demostración comercial. No sustituye asesoría legal, contable ni bancaria.
Los precios, contactos y marcas de pasarelas son de ejemplo. Si necesitas producción,
rota todos los secretos, usa dominios propios y valida cumplimiento tributario boliviano.
