# VERIFICACION — Registro honesto de pruebas ejecutadas

**Fecha:** 2026-11-09 · **Entorno:** sandbox Linux (Node v20.20.2, npm 10.8.2, Python 3.12, PostgreSQL 17.11)

Este documento lista lo que se ejecutó y su resultado exacto. Lo que no está aquí, no se hizo. **La sección 24 es el estado actual del despliegue GHCR/Azure y prevalece sobre las referencias históricas a ACR de las secciones 22–23.**

## 1. Base de datos PostgreSQL 17 (creada desde cero en este entorno)

- `createdb fashionstore` ✔
- `database/schema.sql` ✔ (roles `app_runtime`, `app_readonly`, `web_anon`, `app_user`; extensión `pgcrypto`)
- Migraciones 003–009 aplicadas en orden, `ON_ERROR_STOP=1` ✔ (NOTICES benignas sobre objetos inexistentes en DROP/REPLACE)
- `database/seed.sql` ✔ (tenant `legacy`, 2 sucursales, 5 usuarios demo, catálogo 8 productos / 24 variantes)
- Rol de app `fs_service`/`fs_app`: LOGIN NOSUPERUSER + membresía `app_runtime` **y** `app_readonly` ✔
- `public.meta.esquema_version = 9` ✔
- Hallazgo corregido en este ciclo: `/api/health` consultaba `meta` con el rol crudo de conexión → `permission denied for table meta`. Se cambió a `SET LOCAL ROLE app_readonly` (mismo patrón que el resto del código) y `fs_service`/`user` obtuvieron membresía `app_readonly`. Ahora `/api/health` → `{"estado":"ok","schema_version":9}` ✔

## 2. NestJS API (`backend-nest`)

- `npm run build` ✔ (`tsc` limpio)
- 5 suites de integración (`test:smoke`, `test:subscription`, `test:sync`, `test:reportes`, `test:ia`) — **re-ejecutadas sobre el estado final: 5/5 PASS** ✔ (2026-11-09 18:05)
- Arranque en vivo + `/api/health`, `/api/salud` → 200 `{"estado":"ok"}` ✔
- Login `admin@fashionstore.bo / Fashion2026!` con `X-Tenant-Slug: legacy` → JWT 201 ✔
- Multi-tenant: sin header → `400 TENANT_SLUG_REQUIRED` ✔ · slug inexistente → `404 TENANT_NOT_FOUND` ✔ · token de `legacy` contra tienda nueva devuelve lista vacía (RLS + contexto) ✔ · nuevo tenant registrado (`e2e-verify-<ts>`) con login propio y datos vacíos ✔

## 3. Sincronización offline end-to-end (curl contra API real y base real)

| # | Prueba | Resultado |
|---|--------|-----------|
| 1 | `POST /ventas/sincronizar-offline` con 1 operación (efectivo, sucursal 1, variante 1 ×1) | `sincronizada`, `idempotent_replay:false`, venta id 4, comprobante único, fila `operaciones_offline.estado='sincronizada'` ✔ |
| 2 | Replay exacto de la misma operación | `sincronizada`, `idempotent_replay:true`, **misma venta** (no duplica) ✔ |
| 3 | Misma `operacion_offline_id` con otro contenido | `POST /ventas/sincronizar-offline` → `rechazada / IDEMPOTENCY_PAYLOAD_MISMATCH`; `POST /ventas` directo → **HTTP 409** ✔ |
| 4 | Operación con variante 3 × 99999 (stock real = 2) | `conflicto / STOCK_CONFLICT_LAST_UNIT`; fila `operaciones_offline` en estado `conflicto` con `codigo_conflicto=STOCK_INSUFICIENTE` y detalle ✔ |
| 5 | `POST /reservas` con `operacion_offline_id` | creada (id 2, origen `offline_movil`) y **replay idempotente** devolvió la misma reserva con `idempotent_replay:true` ✔ |

## 4. Pagos sandbox (honestidad: nada confirmado por el cliente)

- `POST /ventas` QR → venta `pendiente_pago` / `no_confirmado`, pasarela `libelula_sandbox` ✔
- `POST /pagos/{id}/aprobar-sandbox {webhook_id: WH-E2E-TEST-001}` → pago `aprobado`, `confirmado_proveedor:true`, `webhook_id` persistido; `GET /ventas/:id` → venta `pagada` / `estado_pago:aprobado` ✔

## 5. IA (`backend-fastapi`)

- `pytest tests/` → **4/4 PASS** ✔ (state at 2026-11-09 18:10)
- `PYTHONPATH=. python3 tests/prueba_ia.py` → **6/6 PASS** ✔ → **10/10 pruebas funcionales**
- Hallazgo corregido en este ciclo: al activar `IA_INTERNAL_KEY` (middleware exige `x-ia-internal-key`),
  las pruebas no enviaban la clave y devolvían 401 (1 fallo pytest + 5 fallos funcionales).
  Se parcheó `tests/prueba_ia.py` y `tests/test_ml_api.py` para enviar `x-ia-internal-key`
  tomado de `IA_INTERNAL_KEY` cuando está configurada. CI ejecuta ambas suites.
- `POST /api/ia/talla` {altura 168, peso 62} → `{"talla_sugerida":"M","imc":22,"confianza":0.91}` ✔
- `POST /api/ia/chat` "blusa para oficina" → intención `vestidor_ar`, proveedor `local_rules`, respuesta con catálogo real del tenant ✔
- `GET /api/sync/pull?cursor=0&limit=20` → snapshot: 8 productos, 24 variantes, 34 filas disponibilidad, 2 promociones, `next_cursor:20`, `server_max_cursor:68` ✔

## 6. Frontend web (`frontend-web`, React+Vite PWA)

- `npm run build` ✔ (dist ~302 kB)
- `npm test` → `PWA OFFLINE TEST PASSED ✅` ✔
- Servido por `vite` en 5173 con proxy `/api` y `/assets` → 3000; login contra proxy: 201 ✔

## 7. App móvil (`mobile-app`, Expo SDK 54)

- Paquetes anclados a versiones de Expo SDK 54 (`expo-doctor` **18/18 checks passed**; react 19.1.0 / RN 0.81.5) ✔
- `npm install --legacy-peer-deps` ✔ · `npx tsc --noEmit` ✔ (sin errores)
- `npx expo export --platform android` ✔ (bundle `_expo/static/js/android/index-*.hbc`, ~2 MB)
- `react-native-webview` 13.15.0 y `expo-sharing` ~14.0.8 verificados contra `bundledNativeModules.json` del SDK 54 ✔
- **NO instalado en dispositivo físico ni emulador** (requiere `eas login` + `eas build`).
- `build-apk.bat` corrige el orden: `mkdir builds` ocurre **antes** de redirigir `ultima-build.json`.

## 8. Integración del stack completo (`iniciar.py --native`)

- `iniciar.py` levantó PostgreSQL + FastAPI (venv dedicado `.venv-ia` creado al vuelo) + NestJS + Vite ✔
- Health anidados OK: `http://127.0.0.1:3000/api/health`, `http://127.0.0.1:8000/api/salud`, `http://127.0.0.1:5173/` ✔
- Login admin a través del proxy web (5173→3000): HTTP 201 ✔
- Procesos permanecen como proceso `FashionStore Stack` en el sandbox.

## 9. NO ejecutado / fuera de este entorno

- `docker compose up` real (docker no está disponible aquí); YAML validado con parser YAML.
- Despliegue a Azure/Render/GitHub (no hay cuentas ni proyecto EAS vinculado: `extra.eas.projectId` se dejó deliberadamente fuera de `app.json`; `eas init` debe asignarlo).
- APK instalable (sin credenciales EAS no existe APK; `build-apk.*` exigen `eas whoami`).
- Groq: sin `GROQ_API_KEY`, la IA responde con `local_rules`.

## 10. Empaquetado y manifiesto (estado final)

- `manifest.sha256` regenerado tras los fixes de este ciclo (440 archivos; excluye `.env`, `node_modules`, `dist`, `builds`, `.venv-ia`, `.expo`, `__pycache__`) ✔
- `proyecto.zip` con diseño `fashionstore/...` — **440 entradas, sin `.env` ni artefactos de build** ✔
- `python3 tools/verificar_manifiesto.py --zip` → **440/440 archivos OK · testzip OK · sin secretos en el paquete · RESULTADO: INTEGRO** ✔
- **Fuga corregida durante la verificación:** el paquete intermedio de este ciclo incluía `backend-nest/.env` y `backend-fastapi/.env` (inocuos fuera de red — `IA_INTERNAL_KEY=dev_only...` y `DATABASE_URL` local — pero NUNCA deben viajar). La construcción del zip ahora excluye `.env`/`.env.*` (salvo `.env.example`, que contiene solo placeholders) y `tools/verificar_manifiesto.py` fue **endurecido**: con `--zip` falla si detecta `/node_modules/`, `/builds/`, `/.git/`, `/.venv-ia/`, `/.expo/`, `__pycache__`, `/.env`, `.env.local|.production|.development`, `.fs_app_password`, `.pem` o `.key` dentro del archivo. Así la promesa "sin secretos" la verifica la herramienta, no la buena fe.
- Novedades verificadas en este ciclo: capturas en `docs/screenshots/` (ver §11), fix de credencial demo web/móvil (ver §11), `expo export` y `tsc` re-ejecutados tras el fix de ProbadorAR.
- Los BATs raíz no pudieron ejecutarse en este sandbox Linux (cmd/PowerShell ausentes); su lógica mirror de los scripts Python/bash verificados, y está documentado.
- Fixtures sensibles locales fuera del paquete: `builds/.fs_app_password` (contraseña efímera del sandbox) y `backend-nest/.env`, `backend-fastapi/.env` (secretos de desarrollo locales) — verificado ausentes en `proyecto.zip` ✔

## 11. Verificación de UI en navegador (2026-11-09, Chromium headless via Playwright)

- Capturas guardadas en `docs/screenshots/`:
  `01-inicio.png` (home + hero tenant), `02-catalogo.png` (catálogo con filtros),
  `03-producto.png` (detalle + stock por sucursal), `04-auth.png` (login),
  `05-login-ok.png`, `06-panel.png` (Dashboard KPI admin), `07-pos.png` (POS con caja abierta),
  `08-vestidor.png` (Vestidor AR, modo Silueta Interactiva + calibrador antropométrico),
  `09-carrito-agregar.png`, `10-carrito.png`, `11-checkout.png`, `12-pago-aprobado.png`.
- **Compra E2E completa por UI** (login semilla → catálogo → producto → carrito → checkout → pasarela):
  orden **VTA-20261109-6AA974** (venta id 8), pago `libelula_sandbox`, webhook simulado
  `✅ Simular Confirmación Exitosa` → estado **APROBADO**, toast "Pago confirmado por proveedor
  Sandbox. Stock descontado en firme." ✔ Sin errores de consola ni pageerrors en toda la sesión.
  Nota honesta: la compra descuenta stock real del sandbox (blusa S/azul); es residuo de prueba
  intencional, igual que las operaciones e2e previas.

### Hallazgos y correcciones de este ciclo (UI)

1. **Credencial demo prefijada incorrecta (bug real, web + móvil):** `Auth.tsx` pre-llenaba
   `admin@fashionstore.bo / Admin1234!`, pero la semilla usa `Fashion2026!` → el ingreso demo de
   un clic **siempre fallaba**. Corregido en `frontend-web/src/pages/tienda/Auth.tsx` y
   `mobile-app/src/screens/Auth.tsx` (prefill + textos de ayuda). `frontend-web` recompilado
   (`dist/` regenerado; 0 referencias a `Admin1234!`).
2. **`mobile-app/src/screens/ProbadorAR.tsx` (fix previo, re-verificado):** se eliminó el anti-patrón
   `offsetRef.current = offset` durante render y el doble conteo en `onPanResponderRelease`;
   ahora el gesto PanResponder captura el origen en `onPanResponderGrant` y sincroniza el ref en
   `useEffect`. Tras el fix: `npx tsc --noEmit` ✔ y `npx expo export --platform android` ✔.
3. **`mobile-app/plugins/with-api-cleartext-traffic.js`:** revisado — `usesCleartextTraffic=true`
   solo si `EAS_BUILD_PROFILE !== 'azure'` (dev/preview contra `http://10.0.2.2:3000`); el perfil
   de distribución real exige HTTPS. Aceptado como válido.

### Añadidos (misma fecha, ciclo UI-sweep)

- **Barrido de 13 rutas** (tienda: ayuda, mis-pedidos, mis-reservas, perfil; panel: ventas, reservas, inventario, productos, maestros, propuestas, reportes, suscripcion, usuarios) con Chromium headless — **13/13 OK, cero errores de consola/página**; capturas en `docs/screenshots/sweep/`.
  Herramienta reproducible: `tools/verificar_ui_sweep.py` (solo lectura; `BASE_URL=...` para otra instancia).
- **Fix de layout global:** una tarjeta de Reportes forzaba ancho > viewport (track implícito `auto` del grid se dimensionaba por max-content del `<pre>` del ML). Correcciones en `styles.css`: `.fs-grid { grid-template-columns: minmax(0,1fr); }`, `.fs-card { min-width:0; max-width:100% }`, `.fs-card pre { max-width:100% }`; y en `Reportes.tsx` toolbar con `flexWrap: wrap` + input `flex: 1 1 220px; minWidth: 0`. Verificación JS antes/después: elementos excedentes 12 → **0**; botón "Generar" pasó de x=1228 (cortado) a x=1147 (visible).
- **Reportes IA ejecutados de verdad en navegador:** comando "Ventas confirmadas del mes por sucursal" → Reporte Ejecutivo (8 transacciones, 8 pagadas, **Bs. 2350.00**) con la venta `VTA-20261109-6AA974` como primera fila. **Exportaciones verificadas:** CSV (831 B, parseable), XLSX (openpyxl: hoja `Reporte IA`, 12 filas), PDF (pypdf: 1 página con los mismos datos).
- `npm test` (PWA offline) re-ejecutado tras el rebuild CSS/JSX: **PASSED ✅**.

### B (misma fecha) — Flujos transaccionales y offline end-to-end por UI

Ejecutados con Chromium headless contra la pila viva (login admin semilla):

1. **Reserva online** desde la tienda (producto PRD-CAR-003 → modal Reservar): código **RES-20261109-EEEBDC**, visible en `mis-reservas` y en la cola de atención del panel ✔
2. **POS Offline-First real**: toggle "📡 Offline Activo" en la tienda → `/panel/pos` detecta `MODO OFFLINE SIMULADO` → se agregó Camiseta Pima a la venta → botón "📡 Encolar Venta Offline" → toast `Operacion OFF-VENTA-… guardada en cola offline (IndexedDB)` → badge "🔄 Sincronizar Cola Offline (1)" en el encabezado del panel → sincronización → **badge desaparece** y la venta queda **PAGADA (EFECTIVO, Bs. 110.00, "Consumidor Final")** en `panel/ventas` ✔ (dos ventas de este tipo, una por cada ejecución de la prueba — residuo de sandbox). El toggle offline vive en memoria de React: la navegación SPA lo conserva, recargar la página lo reinicia a Online — es un flag de simulación, no persistencia.
3. **Checkout con cupón** `BIENVENIDA10` (10% sobre Bs. 150+): orden **VTA-20261109-0E9CB8**, monto **Bs. 166.50** (185.00 − 10%) verificado en la pantalla de pasarela; webhook simulado → **APROBADO** ✔
4. Sin errores de consola ni pageerrors en ninguna de las rutas durante los flujos.
5. Capturas en `docs/screenshots/e2e2/` (13–20). `tools/verificar_ui_sweep.py` (solo lectura) ya cubre las 13 rutas principales.

**Residuo de pruebas acumulado en la base sandbox (tenant `legacy`, intencional):** órdenes `VTA-20261109-6AA974` (Bs. 185), `VTA-20261109-0E9CB8` (Bs. 166.50, cupón), dos POS offline sincronizadas (Bs. 110 c/u), reservas `RES-20261109-EEEBDC` y una duplicada de la ejecución anterior, venta e2e previa de sincronización (`ventas` id 4–5) e id 8. Stock descontado en consonancia.

### C (misma fecha) — Alta SaaS real, barrido de producción y P0 del Service Worker

**Alta de tienda nueva por la UI (flagship SaaS):** botón "+ Crear Tienda SaaS" en el banner anónimo →
modal pre-rellena slug (`boutique-e2e-20261109`) y contraseña demo → submit → la app cambia a la nueva
tienda y entra como su admin. Verificado:
- `url tras alta: /tienda/boutique-e2e-20261109` ✔ · toast "creada con Trial Demo de 14 dias" ✔
- Catálogo propio vacío (`/tienda/boutique-e2e-20261109/catalogo`) ✔ · Panel KPI propio cargando en ceros ✔
  (aislamiento RLS: cero datos del tenant `legacy` visibles — ventas/reservas/inventario propios).
- Capturas en `docs/screenshots/e2e3/` (21–24).

**Barrido de producción real (vite preview = build + proxy, espeja el nginx de despliegue):**

1. **P0 — La PWA abría EN BLANCO sin red.** El Service Worker cacheaba el shell (`/index.html`, iconos,
   prendas y la respuesta de `/api/catalogo/*`) pero **no el bundle JS/CSS** (`/assets/index-*.js|css`,
   que además no coincidía con ninguna regla del SW): sin red, el navegador cargaba `index.html` y el
   bundle fallaba → cuerpo vacío. Detectado al hacer la prueba offline real (el handler `fetch` no
   interceptaba `/assets/index-*.js`). **Fix:** regla cache-first de runtime para assets estáticos del
   build (`js|css|png|jpe?g|svg|webp|gif|ico|woff2?|ttf|webmanifest`, origin propio, excluyendo `/api/`),
   con regresión añadida a `test/pwa-offline.mjs` (exige la regla en `public/sw.js`). Tras el fix,
   **PWA offline real: SW activo y controlando la página → recarga con la red cortada muestra el catálogo
   completo con datos reales** (Blusa Seda Imperial 54 disp. — stock post-ventas) ✔ y la página Ayuda
   funciona offline ✔. Captura: `docs/screenshots/e2e3/25-pwa-offline.png`.
   Además, en modo offline las imágenes emplean cache SW (`/assets/prendas/*`), no la red.
   **Nota de entorno:** la PWA solo se registra con `import.meta.env.PROD` (build); el `vite dev` de
   desarrollo NO registra SW por diseño.

2. **Colisión de `/assets/` en el proxy y en nginx (bug latente de despliegue):** el proxy reenviaba
   TODO `/assets/*` a NestJS, incluido el propio bundle del build → `vite preview` (y el
   `nginx.conf` de producción) servían 404 para `/assets/index-*.js`. **Fix:** proxy y
   `location` ahora son `/assets/prendas/` únicamente (lo único que sirve NestJS); los assets del
   build salen del propio `dist/`. Verificado con curl: bundle 200, prendas 200.
   `nginx.conf` corregido en consecuencia (el despliegue docker nunca se ejecutó en este entorno).

3. **`vite preview` no proxeaba `/api`** (a diferencia de `server`): añadido `preview.proxy`
   idéntico al de dev → `npm run preview` sirve el build de producción localmente con el mismo
   comportamiento que el nginx de despliegue. Documentado en README el flujo "producción local":
   `npm run build && npm run preview` → http://localhost:4173.

**Residuo adicional (intencional, tenant sandbox):** tenant `boutique-e2e-20261109` con 1 admin
(trial 14 días, catálogo vacío). Nada se borró.

### D (misma fecha) — Asistente IA, talla, devoluciones, entrega y fix del reintento de pago

- **Asistente IA por UI**: "blusa para la oficina" → respuesta con contexto de catálogo del tenant
  (Motor Local Determinista / `local_rules`) ✔ (`docs/screenshots/e2e4/26-asistente-ia.png`).
- **Vestidor — recomendador antropométrico**: altura 172 / peso 78 → **Talla L (IMC 26.4 · confianza 91%)** ✔ (27).
- **Modal Comprobante** (Mis Pedidos → Ver Comprobante): comprobante `VTA-20261109-0E9CB8`, APROBADO, con
  línea de ítem, descuento `-Bs. 18.50` y total coherente con el cupón (`Bs. 166.50`) ✔ (28).
- **Entrega de pedido POS**: `VTA-20261109-71D411` → estado **ENTREGADA** ✔ (29).
- **Devolución**: `VTA-20261109-137865` → **REEMBOLSADA**, toast `Reembolso: Bs. 110.00`, stock devuelto ✔ (30, 31).
- **Rechazo → reintento → aprobación (bug REAL corregido en esta tanda):** el flujo
  rechazar→reintentar→aprobar aprobaba el cobro en el servidor pero la pantalla seguía mostrando
  **RECHAZADO** con la referencia del pago viejo (y un toast de éxito), porque `Pago.tsx` re-consultaba
  siempre el `id` de la URL en vez del pago efectivo, y tras `reintentar` la URL no apuntaba al nuevo pago.
  **Fix (cliente):** `cargarPago(pago.id)` tras aprobar/rechazar y `navigate('/pago/{nuevo.id}?venta_id=…',
  { replace: true })` tras reintentar. Re-verificado por UI en orden nueva (`VTA-20261109-BA417F`):
  rechazo → PENDIENTE con nueva referencia (`PAY-20261109-2FA8F0`) → confirmación → pantalla **APROBADO** correcta ✔
  (`docs/screenshots/e2e5/32–35`).
- Residuo sandbox adicional (intencional): orden `VTA-20261109-C49620` (rechazo→reintento previo al fix,
  UI quedó mostrando RECHAZADO pese al aprobado servidor-side), orden `VTA-20261109-BA417F`
  (rechazo→reintento→aprobación con el fix, pantalla correcta), `VTA-20261109-0E9CB8` (cupón),
  ventas POS `71D411` (ENTREGADA) y `137865` (REEMBOLSADA, stock restituido).


## 12. Fix: contraseña de PostgreSQL fuera del código (Windows, `iniciar.bat`)

**Síntoma reportado (Windows 10/11, `iniciar.bat`):** `psql` pedía la contraseña del
superusuario en cada arranque (varios prompts) y luego fallaba con
`FATAL: la autentificación password falló para el usuario «usuario»` dentro de `schema.sql`.

**Causa raíz (bug real):** la ruta de aplicación de archivos SQL (`sql_file()`), cuando no había
`PGPASSWORD` ni `sudo`, invocaba `psql` **sin `-h` ni `-U`** → psql usaba el host y el usuario del
SO (de ahí `«usuario»`) y pedía la contraseña por consola bloqueando el proceso.

**Fix en `iniciar.py`:**
1. `sql_file()` y `psql()` ahora **siempre** pasan `-h 127.0.0.1 -U postgres` (o `-U <user>`).
2. Nuevo `builds/.pg_password` (una línea): fuente persistente para la contraseña del superusuario,
   leída por `iniciar.py` una sola vez por arranque y exportada como `PGPASSWORD` a los `psql`.
   Si no existe y hay consola interactiva, se pide **una** vez con `getpass` y se guarda allí
   (permisos 600 en POSIX; `builds/` ya está fuera de git y de `proyecto.zip`).
   Precedencia: `PGPASSWORD` (entorno) > `builds/.pg_password` > peer auth por `sudo` (Linux) > pedir una vez y guardar.
3. Mensaje de error de conexión actualizado para guiar al usuario al archivo.

**Verificado en este sandbox:** lectura del archivo (comentarios/vacías ignoradas), precedencia de
`PGPASSWORD`, rama "archivo" simulando Windows, rama "sin fuente + sin consola" (falla clara con
instrucciones, código 2), guardado con permisos y la ruta Linux (`sudo peer`) sin regresión.
**NO verificado en la máquina Windows del usuario** (este sandbox es Linux): el flujo interactivo
de `getpass` en consola de Windows y las ACL de `pgpass` no se ejercitaron allí; probado por
simulación de ramas.


## 13. Fix: PostgreSQL en español + base de datos antigua (Windows, `iniciar.bat`, 2026-11-10)

**Síntoma reportado tras aplicar §12:** `[fashionstore] Creando base de datos y aplicando schema...`
seguido de decenas de `NOTICE: la relación «...» ya existe` y luego
`psql:.../schema.sql:480: ERROR: no existe la columna s.id` («stock») y
`CalledProcessError ... exit status 3`.

**Causas raíz (2 bugs reales en `iniciar.py`, ninguno de datos del usuario):**
1. **Detección de "la base ya existe" dependiente del locale.** `ensure_postgres()` buscaba el
   texto inglés `"1 row"`/`"0 rows"` en la salida de `psql`. En un PostgreSQL en español el pie
   de página es `«(1 fila)»/«(0 filas)»`, así que: la base SIEMPRE parecía inexistente →
   `CREATE DATABASE` se intentaba; su error (`la base ya existe`) se **tragaba** porque
   `psql()` usa `capture_output=True` SIN comprobar el código de salida; y `schema.sql` se
   reaplicaba sobre la base existente.
2. **La base `fashionstore` del equipo del usuario proviene de una copia ANTERIOR del
   proyecto** (de ahí los `NOTICE ... ya existe` en TODAS las tablas): su tabla `stock`
   nunca tuvo `id`, por lo que `CREATE OR REPLACE VIEW disponibilidad_sucursal` (que usa
   `s.id`) revienta con `ON_ERROR_STOP=1`.

**Fix (3 partes, todo en `iniciar.py`):**
- `psql()` ahora usa `-tA` (tuplas sin encabezado, valores crudos): salida **idéntica en
  cualquier locale**; los textos de estado se parsean por valor (`strip() == "1"`), nunca por idioma.
- `CREATE DATABASE` / `DROP DATABASE` comprueban el código de salida y abortan con el error real
  (antes era silencioso).
- **Preflight de compatibilidad** cuando la base ya inicializada existe: exige la columna
  `stock.id` y `meta.esquema_version = '9'`; si no se cumplen, **falla con instrucciones claras**
  en lugar de reventar a medias o (§14: hoy el modo fábrica es el default y la recreación es automática)
  arrancar contra un schema viejo.

**Verificado en este sandbox (Linux, sudo peer):**
- DB actual compatible → "Base de datos ya inicializada", sin errores.
- DB simulada de schema antiguo (stock sin id, esquema_version=4) → código 3 con el mensaje guía,
  **sin tocar datos**.
- Ruta de creación desde cero (CREATE DATABASE real + schema/seed simulados) → el flujo procede;
  la ruta `fs_app` quedó simulada para no alterar el rol global.
- `LC_ALL=es_ES.UTF-8 psql ...` reprodujo el pie `«(1 fila)»` que engañaba al parser anterior.

**Pendiente en la máquina del usuario (no ejecutable desde aquí):** actualizar `iniciar.py` a este
fix (o re-extraer `proyecto.zip`). La vía normal es ejecutar `iniciar.bat`: elimina la base antigua
y crea la fábrica actualizada (ver §21); `--keep-db` se retiró.


## 14. Modo fábrica por defecto + datos de ejemplo en TODOS los módulos (2026-11-10)

**Solicitud del usuario (Windows, `iniciar.bat`):** «Cada vez que se inicie `iniciar.py`, elimine
totalmente la base de datos y restaure absolutamente todo de fábrica, y absolutamente todas las
funciones tienen que tener datos de ejemplo.»

### 14.1 Cambio de comportamiento

- Cada arranque hace **DROP + CREATE** de la base `fashionstore` y reaplica schema + migraciones + seed: **fábrica siempre**. Se eliminó el prompt interactivo `BORRAR` (incompatible con doble-clic) a favor de un aviso en consola («MODO FÁBRICA»).
- En el corte histórico de §14 existía `--keep-db`; la corrección posterior de §21 deshabilita esa excepción. `--reset-db` sigue aceptado (obsoleto: fábrica ya es el default). `resetear-demo.bat` ejecuta el mismo reset.
- Docker: el volumen `pgdata` se elimina en cada arranque (mismo modo fábrica).
- **Bug preexistente corregido:** el camino `--reset-db` hacía DROP pero **nunca CREATE** →
  `schema.sql` se aplicaba a una base inexistente y el orquestador moría con traceback.
  Ahora la recreación es explícita y verificada (código de salida comprobado).

### 14.2 Datos de ejemplo para todos los módulos (seed.sql §15)

Nuevas secciones en `database/seed.sql` (todo `tenant='legacy'`):

| Módulo | Ejemplo añadido |
|---|---|
| Ventas pendientes | VTA-2026-0004 — `pendiente_pago` + `BIENVENIDA10`, total Bs. 265.50 |
| Pago rechazado | PAY-DEMO-0005 — `rechazado` (fondos insuficientes sandbox), venta VTA-2026-0005 `cancelada` |
| Pago pendiente | PAY-DEMO-0004 — `pendiente` (para el flujo «reintentar pago») |
| Devoluciones | Devolución **REEMBOLSADA** Bs. 305.00 (Vestido Gala, venta VTA-2026-0002) + item |
| Recepciones | REC-2026-0001 `completada` (Bs. 1,325) y REC-2026-0002 **en_transito** (Bs. 1,750) a Equipetrol |
| Inventario | 5 `movimientos_inventario` (recepción/venta/reserva/devolución) con `saldo_*` **leído por subquery del stock actual** (coherente por construcción) |
| POS offline | OP-DEMO-0001 `sincronizada` y OP-DEMO-0002 `pendiente` (sync queue), tipo `venta` |
| Interacciones | 6 (catálogo, probador_ar, carrito, compra, búsqueda, recomendación) |
| Recomendaciones IA | 2 (`hibrido_reglas_contenido`) |
| Asistente IA | 3 conversaciones (talla/stock/reporte), `proveedor_llm='local_rules'` (Motor Local Determinista) |
| Auditoría | 4 eventos (login, venta_pos_pagada, stock_critico, devolucion_reembolsada) |
| Caja | Caja 2 **CERRADA** Equipetrol con arqueo (Bs. 630) — historial junto a la caja 1 `abierta` |
| Reservas | RES-DEMO-002 **finalizada** (+ detalle) — junto a la `preparada` existente |
| Propuestas | Propuesta de proveedor **aprobada** (junto a la pendiente) |
| Notificaciones | 3 nuevas: alerta stock crítico, devolución reembolsada, recepción en tránsito |
| Suscripción SaaS | 2 `solicitudes_suscripcion`: `pendiente_aprobacion` (Profesional) y `aprobada_sandbox` (Básico) |

`catalogo_cambios_feed` se llena **sola** (triggers de migración 007 sobre productos/variantes/stock).

### 14.3 Verificación ejecutada aquí (Linux)

- Base desechable `fashionstore_seed_test` creada aplicando schema + 9 migraciones + seed nuevo:
  **35/35 tablas con datos** (conteos exactos; incluidas `auditoria=4`, `conversaciones_ia=3`,
  `recomendaciones_ia=2`, `solicitudes_suscripcion=2`, `recepciones=2`, `operaciones_offline=2`,
  `movimientos_inventario=5`, `devoluciones=1`…). Checks de filas clave OK; `esquema_version='9'`.
  La base de prueba se eliminó después.
- Mecánica del auto-reset sobre base desechable `fashionstore_wipe_test/2`: **DROP + CREATE**
  verificados (tabla marcadora eliminada), sql_file invocado con schema/seed. La rama de
  conservación probada en ese corte histórico fue retirada en §21.
- `ast.parse` + `python iniciar.py --help` coherentes; hoy la opción histórica `--keep-db`
  falla con un mensaje explícito para evitar que el sistema arranque conservando datos.

### 14.4 NO verificado

- El arranque real en la máquina **Windows** del usuario (el wipe ocurrirá en su próximo
  `iniciar.bat`, destruyendo la base `fashionstore` local — **es el comportamiento solicitado**).
- Suite completa de la aplicación contra la nueva semilla (la cobertura por SQL está probada;
  la comprobación visual por pantallas corresponde al arranque de la app).


## 15. Fix: Windows no ejecuta `npm` (shims .cmd y CreateProcess) — arranque nativo (2026-11-10)

**Síntoma (log real del usuario, tercera corrida):** la base se borró y recreó correctamente
(el modo fábrica de §14 funcionó de punta a punta: schema ✔, migraciones ✔, seed completo ✔,
rol fs_app ✔) y luego reventó en `npm install --legacy-peer-deps`:
`FileNotFoundError: [WinError 2] El sistema no puede encontrar el archivo especificado`.

**Causa raíz (Windows):** `npm`/`npx` no son ejecutables `.exe`, son shims `npm.cmd`. La comprobación
previa (`have()` → `shutil.which`, que sí respeta `PATHEXT`) los encuentra, pero `CreateProcess`
los busca literalmente como `npm` (y les añade `.exe`), por lo que `subprocess.run(["npm", ...])`
mata el proceso con WinError 2. En Linux no pasa (npm es un binario ELF). Segundo run anterior
(schema.sql:480) era la semilla vieja sin el fix de §14; no relacionado.

**Fix en `iniciar.py`:** nuevo `_resolve_command()` aplicado en `run()` y `spawn()`:
en Windows, resuelve el ejecutable con `shutil.which()` y, si el resultado es `.cmd`/`.bat`,
envuelve como `["cmd", "/c", <shim>, ...]`. En POSIX devuelve el comando intacto (sin cambio de
comportamiento). Cubre `npm`, `npx` y cualquier shim `.cmd/.bat` presente o futuro.

**Verificado:** `ast.parse`; unit-test de la rama Windows simulada (`os.name='nt'`, which simulado):
`npm install` → `cmd /c npm.CMD install` ✔; `node dist/main.js` → ruta .exe resuelta directa ✔;
which fallido → comando intacto ✔; POSIX → intacto ✔. **NO verificado en la máquina del usuario**
(este fix se aplica aquí únicamente a nivel de lógica; el arranque real lo ejecuta el usuario).

**Efecto colateral observado (esperado):** con modo fábrica, la contraseña de `fs_app` se
regenera en CADA arranque (ALTER ROLE + reescritura de `builds/.fs_app_password`); la coherencia
está garantizada porque el archivo se reescribe en el mismo arranque antes de levantar la API.


## 16. Arranque casi completo en Windows: puertos ocupados (EADDRINUSE / WinError 10048) (2026-11-10)

**Cuarta corrida del usuario.** El log muestra que TODO el pipeline funciona ya:

- Modo fábrica (§14): base borrada y recreada ✔, schema ✔, 9 migraciones ✔, seed completo ✔.
- Contraseña `postgres`: **volvió a pedirla** (la carpeta se recreó al re-extraer el zip y
  `builds/` queda fuera de `proyecto.zip`) → la escribió de nuevo y se guardó; los próximos
  arranques no preguntarán.
- Fix npm de §15: **funcionó** (`cmd /c ...\npm.CMD install` — 354 paquetes; `npm run build` → tsc OK;
  frontend `npm install` OK; venv `.venv-ia` creado + `pip install` OK; EL SCRIPT DE `dev` de Vite
  ahora usa `--strictPort`).
- FastAPI IA: **«Application startup complete»** ✔ (pero luego no pudo enlazar 8000).
- NestJS API: inicializó **todos los módulos** ✔ y arrancó «Nest application successfully started»,
  pero al hacer `listen` → `EADDRINUSE 0.0.0.0:3000`.
- Vite arrancó pero **5173 estaba ocupado** → se fue a 5174 (silencioso, rompe CORS/config).

**Causa raíz:** procesos de un FashionStore anterior (u otra app) seguían vivos en **3000, 8000 y 5173**.
En la máquina del usuario quedó un stack colgado; en este sandbox hay listeners análogos (pids 7446/7447/7466)
que el preflight detectó correctamente (`[ERROR] ... Puerto 8000 en uso ... Nada se ha borrado ni creado`).

**Fallos latentes adicionales corregidos:**
1. `mode_native` lanzaba los hijos y `wait_for` daba por bueno el puerto si respondía un **servidor viejo**
   → el usuario veía «funciona» mientras su instancia nueva había muerto.
2. Si un hijo moría, el monitor llamaba `fail()` **sin detener a sus hermanos** (vite quedaba huérfano).
3. Vite sin `--strictPort` migraba silenciosamente a 5174, fuera de `CORS_ORIGINS`.

**Fix (todo en `iniciar.py` salvo el script de Vite):**
- Nuevo `fail_if_ports_busy()`: comprueba 8000/3000/5173 **antes de tocar nada** (y antes del DROP de
  la base); si alguno está ocupado, aborta con instrucciones exactas (`netstat -ano | findstr :3000`
  → `taskkill /F /PID <pid>`, o cerrar la ventana del stack anterior, o `detener.bat`) y deja claro
  que **la base de datos no se tocó**.
- `mode_native` y `mode_docker` lo invocan al inicio.
- El monitor de hijos ahora **detiene a los hermanos** al morir uno (`cleanup()` + `sys.exit(4)`).
- `frontend-web`: `dev` = `vite --host 0.0.0.0 --port 5173 --strictPort`.

**Verificado:** ast.parse; preflight simulado (con listeners en 3000/5173/8000 falla con el mensaje
correcto y no borra nada; con puertos libres, pasa). **NO verificado:** el arranque completo en el
equipo Windows del usuario tras liberar los puertos (el inicio depende de su SO).

**Qué debe hacer el usuario:** cerrar las ventanas del stack anterior (o matar los PIDs que ocupan
3000/8000/5173) y ejecutar `iniciar.bat` de nuevo. Todo lo demás ya está probado que funciona en su
máquina (DB, npm, build, venv, IA, NestJS).


## 17. Revisión incremental de onboarding SaaS, resolución de tenant y build (2026-11-10)

### Cambios de código incluidos en esta revisión

- Alta pública `/api/tenants/registro` exenta del middleware global, con `Idempotency-Key` en CORS. Para requests autenticadas, el middleware valida el JWT firmado, resuelve el tenant por `tenant_id` en la base y rechaza desacuerdos entre claim, ruta y `X-Tenant-Slug`.
- `trial` se trata como período de 14 días en la comprobación de escritura y el módulo de suscripción; se programó un barrido diario que llama `suspender_trials_vencidos()` y usa advisory lock en la función SQL.
- Se documentó `max_productos = -1` como ilimitado, se ajustó la restricción y la comprobación de cuota, y la interfaz web muestra el límite ilimitado sin representarlo como `-1 productos`.
- Se sincroniza el registro de `suscripciones` al aplicar un cambio sandbox. El bearer token ya no se guarda en `auditoria_aprovisionamiento`; se crea un JWT nuevo al repetir un alta completada. Un registro concurrente en curso devuelve `Retry-After: 3`; violaciones únicas de NIT/slug se convierten a HTTP 409.
- Se corrigió el guardado del token de onboarding en web/móvil para tomar el `tenant_slug` de la respuesta, no el tenant que la UI tenía antes del alta.
- `docker-compose.yml` monta la migración 010; `iniciar.py` verifica `esquema_version = 10` y el endpoint de salud informa la versión actual.
- El perfil EAS ya no contiene una URL de API ficticia: preview/production deben recibir `EXPO_PUBLIC_API_URL` desde el entorno EAS configurado por el propietario.

### Verificaciones ejecutadas aquí

| Comando | Resultado |
|---|---|
| `backend-nest: npm run build` | Aprobado (TypeScript) |
| `frontend-web: npm run build && npm test` | Aprobado; prueba PWA valida manifest, service worker e imágenes/overlays |
| `mobile-app: npm run typecheck && npm run export:android` | Aprobado; se produjo bundle Expo Android, no APK |
| `backend-fastapi: python -m pytest -q` | 4 passed, 1 warning deprecado Starlette/httpx |
| Parser PostgreSQL (`pglast`) sobre 010 | 60 sentencias parseadas |
| Parser PL/pgSQL sobre funciones definidas en 010 | Las tres funciones parseadas |

### Limitaciones de esta evidencia

- No se ejecutaron `database/schema.sql`, migraciones 003–010 ni seed en PostgreSQL. Parsear SQL solo valida gramática; no verifica roles, constraints, datos previos, RLS ni permisos.
- No se ejecutaron suites de integración Nest, endpoint de alta, carreras de idempotencia, prueba de aislamiento entre tenants, vencimiento de trial ni pago contra una base real.
- No se ejecutaron Docker Compose, scripts `.bat` en Windows, despliegue Azure/Neon, EAS Build ni instalación del APK.

### Estado de alcance del producto

Esta revisión reduce algunos defectos de onboarding/configuración, pero **no satisface la Definición de Terminado del PDF maestro**. Siguen sin evidencia completa la matriz CU-01–CU-21, la paridad funcional web/móvil, el flujo ML persistente (entrenamiento/predicción por tenant), la saga y webhooks HMAC reales, el job de conciliación/reembolso, la bandeja de conflictos con resolución completa, ICONIX/UML trazable, la automatización cloud y la prueba instalada del APK. No presentar el proyecto como terminado hasta cerrar y probar esos puntos.


## 18. Endurecimiento de seguridad y auditoría de dependencias (2026-11-10)

### Cambios aplicados

- **Runtime:** el backend declara `engines.node >=22`; las imágenes builder/runtime de NestJS y la imagen builder web pasan a `node:22-alpine`; README actualizado. El runner CI ya usa Node 22. El entorno base de esta sesión era Node 20.20.2, que el calendario oficial marca EOL; las pruebas siguientes se ejecutaron con Node **22.23.4** temporal. Fuente: [calendario oficial de Node.js](https://nodejs.org/en/about/previous-releases).
- **NestJS/Express 5:** `@nestjs/common`, `core` y `platform-express` 11.2.9; `@nestjs/serve-static` 5.0.5; tipos Express 5. La migración conserva el query parser `extended`, usa wildcards nombrados y excluye `/api{/*splat}` del static server. El trust proxy se configura únicamente en producción.
- **Prueba de seguridad reproducible:** se añadió `backend-nest/test/security-bootstrap.mjs` / `npm run test:security`. Comprueba que un JWT corto impide el arranque; con secreto efímero, arranca sin DB, verifica Helmet/CSP, CORS permitido y denegado, cobertura del middleware wildcard y que el intento de login 21 devuelve 429 tras 20 intentos.
- **Dependencias Nest:** `uuid` queda fijado por override en 11.1.1 para ExcelJS 4.4.0. Prueba Node 22: escritura y lectura de XLSX, 6,394 bytes, OK.
- **Frontend web:** Vite 5.4.21 → 6.4.6 (`esbuild` 0.25.12), `@vitejs/plugin-react` → 5.2.0 y `react-router-dom` → 7.18.5. Se corrigieron los hallazgos npm de Vite/esbuild y React Router.
- **Expo móvil:** se mantuvo Expo SDK 54 para no hacer una migración nativa mayor en esta tanda; override `postcss` a 8.5.23 corrige el hallazgo alto de PostCSS sin cambiar el SDK. Sigue un hallazgo **alto** en `image-size` 1.2.1, usado por Metro 0.83.3. `npm audit fix` (también con `--legacy-peer-deps`) dejó el lock intacto; `--force` proponía un cambio mayor a Expo 52.0.49, así que no se aplicó.
- **CI y `verificar.bat`:** se agregaron `npm audit` para backend/web y la regresión aislada de seguridad. Mobile ejecuta el audit de vulnerabilidades altas al final y queda bloqueado mientras siga el hallazgo alto. En el job Nest, secretos de prueba se generan aleatoriamente por ejecución y se escriben en `$GITHUB_ENV`; se retiraron los literales de credenciales del workflow. PostgreSQL de CI usa autenticación `trust` solo dentro del servicio efímero de prueba, sin contraseña almacenada en el repo.

### Evidencia ejecutada

| Verificación | Resultado |
|---|---|
| `npm ci --legacy-peer-deps` limpio, backend Nest / frontend web (Node 22.23.4) | Ambos instalaron desde lock; 0 vulnerabilidades en cada auditoría de instalación |
| `backend-nest: npm audit --audit-level=moderate` y `--omit=dev` | 0 vulnerabilidades |
| `backend-nest: npm run build` | OK (TypeScript) |
| `backend-nest: npm run test:security` | OK; fail-closed JWT, Helmet/CSP, CORS, middleware wildcard y rate limit verificados sin DB |
| `node --check` sobre todos los `backend-nest/test/*.mjs` | OK |
| Frontend: `npm audit --audit-level=moderate` y `--omit=dev` | 0 vulnerabilidades |
| Frontend: `npm run build && npm test` | OK; Vite 6.4.6 y `PWA OFFLINE TEST PASSED` |
| Mobile: `expo-doctor` | 18/18 checks passed |
| Mobile: `tsc --noEmit` y export Android | OK; bundle Expo `.hbc` de 2.02 MB, **no es APK instalable** |
| Mobile: `npm audit` / `--omit=dev` | 14 vulnerabilidades: 1 baja, 12 moderadas, 1 alta, 0 críticas. `npm audit --audit-level=high` devuelve exit 1 por `image-size` |
| `pglast.parse_sql` para migración 010 | 71 sentencias parseadas; solo gramática, no se aplicó a PostgreSQL |
| YAML de `docker-compose.yml` y `.github/workflows/ci.yml` | Parsean; Compose declara `db`, `backend`, `fastapi`, `frontend` |
| Simulación local del bloque de secretos CI | Generó y validó 5 nombres/valores en archivo temporal; **no se imprimieron** los valores |
| `python -m py_compile tools/preparar_docker_env.py` | OK |

### Límites y pendientes

- El audit mobile hace fallar intencionalmente el nuevo gate alto hasta resolver `image-size` de forma compatible con Expo/Metro; el job CI no se ejecutó en GitHub en esta sesión. El override de PostCSS y el export sí se probaron localmente.
- No hay PostgreSQL/`psql` ni Docker: no se aplicaron migraciones, no se ejecutaron las seis suites Nest de integración ni pruebas de saga/ownership/concurrencia, y no se construyeron ni arrancaron imágenes Compose. Parsear YAML no equivale a validar `docker compose config` o el arranque real.
- No hay `cmd`/PowerShell: `verificar.bat`, scripts Windows, Azure y APK no se ejecutaron en Windows. La exportación Android no acredita instalación ni APK firmado.
- `pip-audit` no está instalado en el intérprete disponible; no se declara auditada la cadena Python de FastAPI.
- Un `npm ci --dry-run` del entorno eliminó los directorios `node_modules`; se restauraron con `npm ci` real en los tres proyectos Node, que finalizó correctamente. No usar ese dry-run como evidencia de que el entorno queda intacto.

Esta ronda mejora el backend y el frontend y deja un bloqueo explícito por el hallazgo alto mobile. **No cierra D1–D9 ni CU-01–CU-21** y no cambia el estado de producto incompleto señalado en §17.


## 19. Cierre documental, PlantUML, panel móvil y paquete (2026-11-10)

Esta sección actualiza solo los resultados efectivamente ejecutados en el corte final local. Las secciones §1–16 conservan la evidencia histórica (principalmente 09-11-2026); §17–18 documentan cambios/corridas previas del 10-11 antes del update Metro y los cambios finales de esta sección prevalecen cuando hay diferencia.

### Entregables y cambios

- `mobile-app/src/screens/Panel.tsx` añade panel operativo filtrado por rol (dashboard, POS, ventas, reservas, inventario, productos, propuestas, reportes/export, suscripción, usuarios, métricas ML y revisión de operaciones). Es una capa móvil sobre endpoints existentes, no prueba E2E ni cierra las brechas de resolución de conflictos/ML.
- Metro coordinado se actualizó de 0.83.3 a 0.83.8 manteniendo Expo SDK 54, sin usar downgrade `--force`.
- Valores de ejemplo de `backend-nest/.env.example` y `backend-fastapi/.env.example` se sustituyeron por placeholders explícitos; el secreto de desarrollo anterior no se conserva en el ejemplo. Las claves del propietario no se guardan aquí.
- `backend-fastapi/requirements-dev.txt`, CI y `verificar.bat` ahora incluyen pytest/pip-audit y sus checks. El archivo CI y los `.bat` no se ejecutaron en su runner/Windows real.
- `tools/paquetizar_proyecto.py` crea manifiesto/ZIP; `tools/test_packaging.py` contiene regresiones de filtros; `manifest.bat` y el job CI corren dichas pruebas antes de empaquetar. `tools/verificar_manifiesto.py --zip` valida hashes, entradas, paths, integridad y patrones conocidos de secretos.
- `docs/TRAZABILIDAD.md`, `AUDITORIA.md`, `DECISIONES.md`, `PROGRESO.md`, `ICONIX.md`, cinco fuentes `.puml` y cinco SVG PlantUML. El baseline CU-01–CU-14 del Primer Parcial queda explícitamente conservado; solo la correspondencia de cada ID con su nombre/criterio no etiquetado queda pendiente. D1–D9/T-01–T-20 normativos no se inventan.

### Ejecuciones verificadas en este corte

| Verificación | Resultado real |
|---|---|
| NestJS — audit moderada, build, `npm run test:security`, `node --check` sobre `test/*.mjs` (Node 22.23.4) | OK; cero vulnerabilidades npm audit reportadas para Nest; suite de seguridad y parseo sintáctico pasan. No se levantó DB para las suites de integración. |
| Frontend web — audit moderada, `npm run build`, `npm test` (Node 22.23.4) | OK; cero vulnerabilidades npm reportadas; `PWA OFFLINE TEST PASSED`. El UI sweep Playwright 13/13 está en §11 como histórico; no se repitió en este corte. |
| FastAPI — `pytest tests -q`, `tests/prueba_ia.py` (venv temporal Python 3.13.16) | **4 passed + 6 passed**; queda warning deprecado Starlette/httpx. |
| FastAPI — `pip-audit --requirement requirements-dev.txt --strict` | Sin vulnerabilidades conocidas en la resolución auditada. |
| Mobile — typecheck, Expo Doctor y export Android (Node 22.23.4) | TypeScript OK; Expo Doctor **18/18**; export Android OK, bundle `.hbc` ~2.1 MB; no APK/dispositivo. |
| Mobile — `npm audit --audit-level=high` | Exit 0; quedan **13** advisories de severidad menor al gate (1 low, 12 moderate). No se afirma riesgo cero. |
| PlantUML 1.2026.9 — `-checkonly docs/uml/*.puml` | Exit 0 para **5/5** fuentes. Se generaron cinco SVG en `docs/uml/rendered/`; parseo `xml.etree.ElementTree` de todos: OK. El JAR se descargó temporalmente a `/tmp`, no se incluyó en el repo/ZIP. |
| Filtros de empaquetado | `python -m unittest discover -s tools -p 'test_packaging.py' -v` → **5 tests OK**. Cubren `.env`/credenciales/builds/screenshots, traversal y entradas prohibidas, marcadores sintéticos de llaves/tokens/URLs con password, placeholders y URL interpolada. Los valores de prueba se construyen en memoria y no se imprimen. |
| Manifiesto y ZIP | **407/407** hashes locales; **408** entradas; `testzip=OK`; sin hallazgos de nombres/paths ni marcadores de secreto; ZIP ~5.45 MB (<15 MiB). |

### Límites del corte actual y reconciliación de historial

- **PostgreSQL:** hay pruebas reales históricas del 09-11 (§1–3), incluida aplicación schema + migraciones 003–009/seed y end-to-end de login, tenant, sync y sandbox. No se debe borrar esa evidencia. Pero migración 010 y el código de inicio/modo fábrica actualizado el 10-11 no se aplicaron a PostgreSQL en el corte actual; su parser no equivale a ejecución.
- **UI:** el sweep 13/13 web, reportes y varios E2E de navegador sí aparecen como históricos en §11. No se repitieron sobre la rama final; el panel operativo móvil nuevo solo se typecheckeó/exportó.
- Sin `psql`/PostgreSQL, Docker, Windows/PowerShell, EAS/ADB/emulador, Azure/Neon autenticado ni Playwright disponible en el entorno actual. Por eso no se afirman ejecución nueva de migraciones/Compose/BATs, despliegue cloud, APK ni test visual móvil.
- Los PDFs maestro/Segundo Parcial y la definición normativa de D1–D9/T-01–T-20 no están en el repo ni se localizaron en la búsqueda disponible de Drive; por eso el mapa exacto de requisitos sigue pendiente.

**Estado final del corte anterior:** artefactos locales y docs parciales generados. La solución no está terminada contra el PDF y la ausencia de evidencia de cloud/APK/Windows/DB final es explícita. No declarar D1–D9, CU-01–CU-21 o T-01–T-20 aprobados.


## 20. Cierre integrado: PostgreSQL 17.11, pagos, sync, ML demo y documentación (2026-11-10)

Esta sección prevalece sobre los estados anteriores de §§17–19 para el corte local actual. Se conserva sin sustitución el baseline del Primer Parcial CU-01–CU-14. La evidencia de este registro es técnica y no asigna PASS a IDs normativos que no se hayan podido inspeccionar.

### Cambios incorporados

- Se corrigió la inferencia de tipos PostgreSQL en la escritura durable de conflictos (`$4::varchar`) y en `saga_pago` para la aprobación tardía (`$2::text`); las suites que revelaron ambos errores pasan ahora sobre DB limpia.
- Se añadió `backend-nest/test/ml-persistence.mjs` y el script `test:ml-persistence`, conectado al workflow CI y a `verificar.bat`. La regresión verifica persistencia/versionado de artefactos sintéticos, predicciones y aislamiento de tenant.
- Tras los logs Windows aportados por el usuario, se añadió `express` `^5.3.0` como dependencia runtime directa y se actualizó `package-lock.json`. Además, `iniciar.py` ahora comprueba Express en la raíz de `node_modules` y ejecuta `npm install --legacy-peer-deps` si falta, aunque la carpeta `node_modules` ya exista. La regresión sintética de este preflight quedó en `tools/test_packaging.py`.
- Se actualizaron trazabilidad, auditoría, progreso y cinco diagramas `.puml`; los SVG se volvieron a renderizar tras los cambios.

### PostgreSQL y regresiones integradas

- PostgreSQL **17.11** se ejecutó desde binarios temporales extraídos bajo `/tmp`, con listener de prueba en loopback; no se instaló como servicio del sistema.
- Se recreó `fashionstore` desde cero; `database/schema.sql`, migraciones `003`–`010` y `database/seed.sql` se aplicaron con `ON_ERROR_STOP=1`. `public.meta` confirmó `esquema_version=10`.
- FastAPI y NestJS arrancaron localmente; Nest `/api/health` devolvió `estado=ok` y `schema_version=10`. Las pruebas se ejecutaron en este orden en la DB limpia:

| Suite | Resultado | Cobertura observada |
|---|---|---|
| `test:smoke` | **PASS** | Salud, login/catálogo, onboarding e aislamiento de tenant, pago sandbox e idempotencia/conflicto offline. |
| `test:sync-conflicts` | **PASS** | Persistencia de conflicto, reposición auditable, reintento único, replay y descarte auditado. |
| `test:payments` | **PASS, 8/8 pasos** | Reserva/expiración, reintento, webhook firmado, conciliación, aprobación tardía, reembolso sandbox idempotente y devolución con reposición de stock. |
| `test:subscription` | **PASS** | Trial/cuotas, rechazo de segunda sucursal y cambio de plan en sandbox. |
| `test:sync` | **PASS** | Snapshot inicial, evento incremental y pull sin cambios. |
| `test:reportes` | **PASS** | Consulta estructurada y firmas binarias PDF, XLSX y CSV. |
| `test:ia` | **PASS** | Proxy FastAPI, asistente acotado al tenant, talla/AR y métricas ML. |
| `test:ml-persistence` | **PASS** | Entrenamiento de tres modelos demo/versiones monotónicas, escritura/lectura de predicciones y aislamiento respecto de un tenant nuevo. Datos sintéticos. |

**Resultado agregado: 8/8 suites de integración PASS** con NestJS + FastAPI + PostgreSQL local. No se ejecutó el workflow de GitHub ni `verificar.bat` en Windows. Las pruebas cubren las rutas indicadas, no todos los escenarios de producción ni la aceptación CU/T/D.

### Verificaciones adicionales de esta ronda

| Componente | Resultado real | Límite |
|---|---|---|
| NestJS, Node 22.23.4 | `npm ci --legacy-peer-deps` limpio: OK; Express **5.3.0** resuelto; build, `test:security`, sintaxis de `test/*.mjs` y audit de producción (0 vulnerabilidades) pasan. `iniciar.py` ahora detecta Express ausente incluso con `node_modules` existente; la prueba unitaria de ese caso pasa. | No ejecuta `iniciar.bat` en Windows; falta confirmar el arranque completo allí con el paquete actualizado. |
| Web, Node 22.23.4 | `npm audit --audit-level=moderate`: 0 vulnerabilidades; build OK (JS 328.08 kB, gzip 96.18 kB); `npm test` → `PWA OFFLINE TEST PASSED`. | El sweep Playwright 13/13 de §11 es histórico y no se repitió sobre esta versión. |
| FastAPI, venv temporal Python 3.13 | `pytest -q`: **8 passed**; `tests/prueba_ia.py`: **6 passed**; `pip-audit --strict --requirement requirements-dev.txt`: sin vulnerabilidades conocidas. | Un warning deprecado Starlette/httpx. Pruebas unitarias no sustituyen la integración DB indicada arriba. |
| Móvil, Expo SDK 54 | Typecheck y export Android OK; bundle Hermes **2.13 MB**. Expo Doctor **18/18** y prebuild Android OK en esta ronda; `RECORD_AUDIO` y `RecognitionService` presentes. | No es APK; no hubo Gradle/EAS, emulador/dispositivo ni prueba de voz, cámara, transferencia o venta nativa. |
| Móvil — audit | `npm audit --audit-level=high`: exit 0; **13 avisos** remanentes (1 low, 12 moderate). | No se usó `--force`; no significa riesgo cero. |
| PlantUML 1.2026.9 | `-checkonly` y render Smetana de **5/5** diagramas; los cinco SVG parsean como XML. | Valida sintaxis/render, no cumplimiento normativo ni conducta de producto. |
| Filtros, arranque y paquete | `python -m unittest discover -s tools -p 'test_packaging.py' -v`: **6 tests OK**, incluido el caso `node_modules` existente sin Express. El manifiesto/ZIP previo tenía **411/411** hashes, **412** entradas y `testzip=OK`; regenerar tras estos cambios. | Aún no es una ejecución de Windows; el escaneo de secretos solo cubre patrones conocidos. |

### Fuente normativa y límites de producto

- La búsqueda de Google Drive encontró el candidato `INF432_SE2_GXX.zip` (5,076,155 bytes; modificado 31-10-2026). La lectura conectada no extrae ZIP; no se inspeccionó su contenido. Por tanto D1–D9, T-01–T-20 y los criterios individuales CU-01–CU-21 continúan sin mapeo/aceptación normativa verificable.
- Pagos, cambios de plan y reembolsos siguen en **sandbox**: no se movieron fondos ni se llamó a una pasarela real. El efectivo es registro manual.
- ML usa exclusivamente datos sintéticos reproducibles. La persistencia se probó en DB, pero no es entrenamiento ni decisión comercial con datos reales.
- `test:sync-conflicts` verifica integración local, no competencia de varios dispositivos físicos. No hubo prueba de voz en dispositivo ni APK firmado.
- No hubo despliegue Azure/Neon, CI remoto ni ejecución de scripts Windows. Dos logs de Windows muestran que schema/migraciones concluyen pero Nest falla porque Express no es resoluble; el segundo no muestra pasos npm/build. Además de declarar Express directo, `iniciar.py` ahora valida con Node la resolución de Express y los paquetes Nest runtime, y reinstala si falta alguno incluso cuando `node_modules` existe. El caso incompleto pasa una regresión unitaria, pero Windows **sigue pendiente de confirmación**: aplicar el ZIP actualizado, comprobar Express 5.3.0 y ejecutar `iniciar.bat` (restaura fábrica; `--keep-db` ya no se admite). La ruta está dentro de OneDrive: `builds/.pg_password` y `builds/.fs_app_password` pueden sincronizarse; estar ignorados por Git/ZIP no los excluye de OneDrive. Mover el proyecto fuera de la carpeta sincronizada y, si el secreto ya se sincronizó, rotar la contraseña de `postgres`. El árbol de screenshots/sweep previo sigue siendo evidencia histórica, no revalidación visual de esta versión.

### Estado de entrega

La integración backend pendiente al inicio de esta sección queda **resuelta para las ocho suites locales indicadas**. No se debe generalizar a D1–D9, CU-01–CU-21 o T-01–T-20 ni anunciar como producción. El paquete indicado aquí corresponde al corte anterior y se vuelve a generar en §21.

## 21. Factory reset completo, muestras recientes y reinicio de clientes persistidos (2026-11-10)

### Cambios de comportamiento

- El seed ahora publica `meta.factory_generation` (UUID nuevo por cada seed/arranque de fábrica). `/api/health` y `/api/salud` exponen ese valor junto con `schema_version`.
- El cliente web compara la generación antes de montar pantallas. Si cambió, fuerza el tenant `legacy`, elimina las claves `fs_*` (incluidos JWT/usuario/carrito/sync cursor), limpia IndexedDB (outbox + catálogo), y borra en Cache Storage las respuestas de `/catalogo/` y `/sync/pull`. Las rutas `/tienda/{slug}` se redirigen a `/tienda/legacy`. Si la API está offline, la app conserva el modo offline y vuelve a validar al reconectar.
- El cliente móvil realiza la misma comprobación contra SQLite `kv_meta`; al detectar cambio elimina JWT de SecureStore de los tenants conocidos, carrito/sesión, looks locales, outbox/cache SQLite y la cola heredada de AsyncStorage, luego activa `legacy`. Las operaciones pendientes viejas no se sincronizan contra el nuevo dataset.
- `iniciar.py` recrea en nativo la base en UTF-8 (`TEMPLATE template0`) en cada arranque; Docker elimina siempre el volumen `pgdata`. `--keep-db` permanece oculto solo para rechazarlo antes de entrar al modo Docker/nativo: no inicia servicios ni conserva/accede a la base. Windows real permanece pendiente de confirmación.

### Datos de fábrica añadidos para las tablas recientes

Además de los ejemplos anteriores, `database/seed.sql` incluye suscripción Trial y solicitudes SaaS; una venta a crédito con abono parcial (saldo Bs. 195); cuenta por cobrar/abono; dos dispositivos sync y un conflicto offline; ejemplo de idempotencia; reportes generados; tres modelos ML demo, tres predicciones y tres perfiles de segmento sintéticos; webhook sandbox coherente con un pago aprobado; y sagas durables para **todos** los pagos del seed (la migración 010 corre antes de los pagos semilla). Los datos ML llevan la marca sintética y texto de gobernanza. Todas las muestras son ficticias; no se ejecutan cobros reales.

### Verificación local de este cambio

- PostgreSQL **17.11 temporal**, DB desechable creada con `--encoding=UTF8 --template=template0`: schema, migraciones 003–010 y seed aplicados con `ON_ERROR_STOP=1`. En el estado inmediatamente posterior al seed, `server_encoding=UTF8`, `esquema_version=10` y `factory_generation=3e27b4b9-9617-47d0-bc0d-13e919b273f1`. Conteos de fábrica: 6 ventas, 5 pagos y 5 sagas, 1 suscripción, 2 solicitudes SaaS, 1 cuenta por cobrar y 1 abono, 2 reportes, 3 modelos ML, 3 predicciones, 3 segmentos, 2 dispositivos sync, 1 conflicto, 1 webhook y 1 registro de aprovisionamiento. Además, `ensure_postgres()` del launcher se ejecutó end-to-end en otra DB temporal: DROP + CREATE UTF-8/TEMPLATE template0, schema + migraciones + seed; verificó versión 10 y conteos de 6 ventas/5 pagos; la DB de esa prueba se eliminó después.
- La comprobación directa de `GET /api/health` devolvió `schema_version=10` y el mismo `factory_generation` que `meta`; el smoke test también valida el UUID v4 en `/api/salud`, además de login, catálogo, venta a crédito, saga y webhook sandbox.
- **Nueve suites Nest** contra PostgreSQL recién sembrado: `test:smoke`, `test:payments`, `test:subscription`, `test:sync`, `test:sync-conflicts`, `test:reportes`, `test:ia`, `test:ml-persistence` y `test:security`: **9/9 PASS**.
- NestJS `npm run build`: PASS. Web `npm run build && npm test`: PASS; PWA valida redirección con `replace` a `/tienda/legacy` desde rutas ajenas, preserva sus subrutas y confirma que `AppProvider` que usa `useNavigate` está dentro de `BrowserRouter`. Móvil `npx tsc --noEmit` y export Android con `CI=1 npx expo export --platform android --output-dir dist`: PASS (bundle Hermes 2.14 MB; no es APK).
- FastAPI `pytest -q`: **8 passed**, con un warning de deprecación Starlette/httpx. Los recorridos Nest `test:ia` y `test:ml-persistence` también pasaron contra los endpoints FastAPI y la DB sembrada.
- Launcher/paquete: `tools/test_packaging.py` **8/8**; `py_compile` y `iniciar.py --help` pasan. Se revisaron todas las referencias a `--keep-db`: las menciones son históricas o indican su rechazo; no queda una instrucción vigente que permita conservar la base ni una ruta de preservación en el código. El launcher la rechaza antes de entrar a un modo de arranque y no ofrece esa opción en `--help`; una regresión verifica que no se invoque Docker ni el modo nativo.
- La compilación y ejecución se hicieron en Linux; el sandbox usa Node **20.20.2**, aunque Nest declara Node `>=22`. Windows real, Docker Compose real, recorrido visual completo y prueba en teléfono siguen sin confirmarse.

### Paquete

`python tools/paquetizar_proyecto.py` regeneró `proyecto.zip` y `manifest.sha256`: **413 archivos** registrados y **414 entradas** en el ZIP (incluye el manifiesto). `python tools/verificar_manifiesto.py --zip` terminó **PASS**: hashes locales completos, contenido del ZIP íntegro, lista exacta, manifiesto interno coincidente y sin rutas/secretos prohibidos; el archivo queda bajo el límite de 15 MiB. Los SHA-256 finales se reportan aparte al entregar los artefactos, porque incluirlos en este documento cambiaría los propios hashes.

## 22. Stripe Checkout test y preflight de despliegue Azure (2026-11-10)

### Cambios implementados

- Se integró Checkout alojado en Stripe test con `STRIPE_SECRET_KEY` exclusivamente `rk_test_`/`sk_test_`, `STRIPE_WEBHOOK_SECRET` del endpoint Stripe, `PAGOS_MODO=sandbox` y `PUBLIC_API_URL` HTTPS en producción. Checkout toma monto/moneda del servidor; el retorno HTML no aprueba el pedido. El webhook usa `rawBody` y `Stripe-Signature`, valida tenant, sesión, referencia, monto y moneda y recién entonces procesa el pago.
- En web y móvil se llama al endpoint para iniciar Checkout y se abre la URL alojada. Si Stripe no está configurado, el simulador aparece identificado como simulación. La aprobación simulada de Stripe queda bloqueada cuando están configuradas credenciales test válidas.
- Se corrigió el campo Stripe SDK a `allowed_payment_method_types`. El secreto del simulador `STRIPE_SIMULATOR_WEBHOOK_SECRET` quedó separado del webhook real y su generación/placeholder se endureció en el launcher Docker/nativo/CI.
- `frontend-web/Dockerfile` acepta `ARG VITE_API_URL`, necesario para que la imagen Azure apunte al FQDN público de Nest y no al proxy local `backend:3000`. El build Vite con URL de API sintética confirmó que queda embebida en el bundle.
- Se añadió `docs/DESPLIEGUE-AZURE.md` para ACA + ACR + Neon. El BAT comprueba requisitos e inicia Azure CLI si hace falta; el asistente Python abre Neon para crear un proyecto manualmente, recibe su URL oculta y, tras confirmación explícita, prepara Neon y aprovisiona Azure. `docs/APK.md` y README enlazan la guía.

### Validaciones ejecutadas

| Verificación | Resultado |
|---|---|
| Backend `npm run build` (Node 20.20.2; requisito declarado >=22) | PASS |
| `npm run test:security` | PASS |
| `npm run test:stripe-webhook` | PASS: firma inválida rechazada, evento ajeno firmado ignorado, Checkout con `payment_status=unpaid` ignorado antes de DB, página de retorno disponible sin tenant. No usa credenciales reales. |
| Web `VITE_API_URL=https://fashionstore-api.example.test/api npm run build` | PASS; URL sintética presente en el bundle generado. |
| Web `npm run build && npm test` | PASS; `PWA OFFLINE TEST PASSED`. |
| Móvil `npm run typecheck` | PASS. |
| `python -m unittest tools.test_packaging -v` | **9/9 PASS**, incluida la separación del secreto simulator respecto del `whsec_` de Stripe. |
| `py_compile` para launcher y herramientas | PASS. |

### Límites — Azure y prueba de pago positiva pendientes

- No se ejecutó un cargo ni llamada a la API de Stripe: no hay secretos Stripe reales configurados. El test de webhook verifica firma y condiciones de rechazo/ignore, pero no el camino completo de pago confirmado en una DB con Neon.
- No se desplegó Azure ni se crearon recursos: en el entorno faltan `az`, Docker y una sesión autenticada. La guía no equivale a un despliegue probado. ACR build remoto permite construir sin Docker local, pero necesita Azure CLI, suscripción y permisos. Neon/Stripe tampoco se autenticaron.
- Para validar completamente se requiere instalar Azure CLI en la máquina que posee la suscripción, hacer `az login`, crear Neon y aplicar schema/migraciones/seed, guardar secretos en Azure, desplegar las tres Container Apps, verificar `/api/health`, configurar el webhook test y completar un pago test. No se deben compartir credenciales aquí.
- BOB depende de la cuenta Stripe y sigue sin validarse. No hay despliegue productivo ni cobros reales autorizados.
- Tras estos cambios, `python tools/paquetizar_proyecto.py` + `python tools/verificar_manifiesto.py --zip` dieron PASS: **415 archivos**, **416 entradas**, ZIP de aproximadamente **5,5 MB**, hashes completos, `testzip=OK` y sin rutas/secretos prohibidos. El SHA-256 final del ZIP se informa al entregar.

## 23. Cierre local del flujo asistido Azure/Neon (2026-11-10)

### Ajustes finales del despliegue

- El BAT inicia sesión con Azure CLI si hace falta, instala/actualiza la extensión oficial `containerapp`, valida `psql` y Python 3.10+, y ejecuta el asistente. El asistente imprime el enlace de Neon (además de abrirlo) para que el usuario cree un proyecto nuevo; recibe localmente la URL directa oculta y solicita confirmación antes de escribir Neon o aprovisionar Azure. Tras `CONTINUAR` puede registrar resource providers en Azure (metadatos, sin crear recursos facturables).
- Antes de escribir Neon, el asistente exige exactamente las ocho migraciones revisadas `003`–`010`; una faltante o un `.sql` inesperado detiene el proceso. Se rechaza la contraseña demo `Fashion2026!` (sin distinguir mayúsculas/minúsculas).
- Después de crear la web, el flujo configura el origen HTTPS exacto en `CORS_ORIGINS` tanto de Nest como de FastAPI; FastAPI sigue siendo interno. Las actualizaciones crean revisiones nuevas.
- La guía y README ahora describen que el flujo está implementado pero no probado en cloud. No prometen costo cero: ACR Basic/build y consumo fuera de cuotas pueden generar cargos.

### Verificaciones locales posteriores a los últimos cambios

| Verificación | Resultado |
|---|---|
| `python -m py_compile tools/deploy_azure.py tools/test_deploy_azure.py` | PASS |
| `python -m unittest discover -s tools -p 'test_*.py' -v` | **25/25 PASS** (incluye orden de resource-provider preflight, inventario de migraciones, CORS en ambos servicios y rechazo de contraseña demo). |
| Inventario del directorio real `database/migrations` | Coincide exactamente con los ocho nombres `003`–`010`. |
| Escáner de marcadores de secreto en archivos modificados | Sin marcadores detectados. |
| Frontend `VITE_API_URL` sintética: build + `npm test` | PASS; destino API presente en bundle y `PWA OFFLINE TEST PASSED`. |
| NestJS `npm run build`, `test:security`, `test:stripe-webhook` | PASS. |

### Pendiente de validación real

No se ejecutó el BAT en Windows ni se autenticó en Azure/Neon; tampoco se creó un Resource Group, ACR, Container Apps, una compilación ACR ni una compra Stripe. El entorno comprobado no dispone de `az`, `psql`, Docker o PowerShell. Por tanto, el despliegue automático está implementado y verificado localmente, pero no se debe declarar desplegado ni probado en vivo. El primer intento cloud requiere una suscripción con permisos/consumo disponibles; si la preparación Neon queda parcial, no se debe repetir el seed sobre esa misma base.

## 24. Migración de ACR a GHCR público — proveedor confirmado por el usuario (2026-11-10)

### Implementación actual

- Para quitar ACR, el código de despliegue construye URLs `ghcr.io/<owner>/fashionstore-{ai,api,web}:latest`, verifica lectura anónima de las tres antes de abrir Neon y crea Container Apps sin registro privado ni identidad de pull. Se eliminó la ruta de `az acr build`. El asistente pide confirmar esta configuración GHCR antes de registrar providers o consultar Azure; una respuesta negativa no modifica Neon ni Azure.
- Se añadió `.github/workflows/publish-ghcr.yml`: GitHub Actions construye/publica las imágenes Linux/amd64 con tags `latest` y `sha-*`. La publicación no se ha ejecutado; después del primer push un operador debe cambiar cada paquete a **Public** en GitHub Packages. El usuario confirmó GHCR; la visibilidad pública expone imágenes compiladas y [GitHub indica que no se pueden volver privadas](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).
- La web se compila con `VITE_API_URL=/api`; el Nginx Azure usa una plantilla de runtime con `API_UPSTREAM`, proxy para `/api/` y `/assets/prendas/` y verificación TLS del upstream. El FQDN Azure no se hornea en el bundle.
- README, BAT y la guía Azure se actualizaron para el flujo GHCR, los paquetes públicos y el costo no garantizado de ACA/egress. Los apuntes históricos a ACR de las secciones 22–23 se conservan como historial; esta sección prevalece.

### Verificaciones locales de esta revisión

| Verificación | Resultado |
|---|---|
| `python -m py_compile tools/deploy_azure.py tools/test_deploy_azure.py` | PASS |
| `python -m unittest discover -s tools -p 'test_*.py' -v` | **31/31 PASS** (incluye confirmación explícita GHCR, preflight anónimo, payload sin ACR/identidad, proxy Nginx y regresiones Neon/packaging). |
| `VITE_API_URL=/api npm --prefix frontend-web run build && npm --prefix frontend-web test` | PASS; compilación Vite y `PWA OFFLINE TEST PASSED`. |
| Parseo YAML local del workflow con PyYAML | PASS de sintaxis YAML; no equivale a validación de GitHub Actions ni a ejecutar el workflow. |
| `python tools/paquetizar_proyecto.py` + `python tools/verificar_manifiesto.py --zip` | PASS: **419 archivos** / **420 entradas**, ZIP 5,534,087 bytes, hash y `testzip` íntegros; incluye workflow y cambios GHCR. |

### No verificado / bloqueo antes de publicar

- El proveedor GHCR ya quedó confirmado, pero no hay evidencia de un repo GitHub remoto accesible, paquetes existentes, ejecución de Actions ni lectura real de los manifiestos. Falta publicar desde el repositorio del usuario y hacer públicos los tres paquetes.
- No se construyeron contenedores, no se validó la configuración con Nginx real, no se ejecutó el BAT en Windows y no se conectó a Neon ni a Azure. No se creó ningún Resource Group, Container App o base Neon.
- La suite local no comprueba cuotas ni facturación. No crear ACR elimina ese registro de Azure pero no garantiza $0 total: Container Apps y egress pueden cobrar fuera de cuotas/créditos. Stripe sigue opcional y en modo test; no hubo compra/webhook vivo.

**Siguiente paso:** subir los cambios a un repo GitHub, ejecutar el workflow, cambiar los tres paquetes a **Public**, confirmar el owner y comprobar sus pulls anónimos. Después se puede ejecutar el BAT localmente: el usuario crea Neon en el navegador y pega la URL en el prompt oculto; solo con confirmación se inicializa Neon y se aprovisiona Azure. Si Neon llega a quedar parcialmente inicializada, no repetir seed sobre la misma base sin inspección.

## 25. Alternativa Node/pg para Neon y robustez de Azure CLI en Windows (2026-11-10)

### Cambios en la automatización

- Se conservó la arquitectura acordada **Azure Container Apps Express + Neon + GHCR público**. La propuesta de App Service F1 del ejemplo no se copió porque cambia el alcance/arquitectura de FashionStore.
- `desplegar-azure.bat` ya no exige instalar `psql`: lo usa si está disponible; de lo contrario, permite el cliente Node si `node` resuelve el paquete `pg` ya declarado en `backend-nest`. Si faltan las dependencias locales, la instrucción es `cd backend-nest && npm ci`. No se instala ni se modifica un servidor PostgreSQL.
- `tools/cloud_sql.js` agrega los modos `file`, `scalar`, `provision` y `verify-app`. Usa TLS con validación de certificado para Neon, mantiene URL/contraseñas en el entorno local, hace cambios de contraseña con parámetros y `format(%L)` del servidor (no depende de `Client.escapeLiteral`, que no forma parte de la API de node-postgres) y valida el rol runtime/RLS.
- El flujo existente conserva `psql` como ruta preferente y usa Node/pg como fallback para preflight de Neon, schema/migraciones/seed, provisión del rol y comprobación de acceso.
- Se añadió una prueba Windows simulada para el paso de argumentos de Azure CLI por PowerShell/JSON, incluso con rutas y argumentos que contienen espacios; el BAT mantiene `call az` para los shims `az.cmd`.
- La prueba de la propuesta externa `test_reiniciar_bd_borra_y_resiembra` no mide el comportamiento del despliegue: su bloque `assertRaises(SystemExit)` contiene solo `pass`, así que no ejecuta una acción que pudiera lanzar `SystemExit`.

### Verificación local

- `node --check tools/cloud_sql.js`: PASS.
- `python -m py_compile tools/deploy_azure.py tools/test_deploy_azure.py`: PASS.
- Las pruebas simuladas cubren conexión TLS, formato seguro de claves, SQL de varias sentencias y rutas con espacios; no se conectan a Neon ni a Azure.
- `python -m unittest discover -s tools -p 'test_*.py' -v`: **46/46 PASS**, incluida la suite de empaquetado, la simulación Node/pg sin Neon real y el wrapper PowerShell de Azure CLI simulado con rutas que contienen espacios.

### Límites

El fallback elimina el requisito de instalar `psql` cuando ya están disponibles Node y `backend-nest/node_modules/pg`; no elimina la necesidad de una cuenta Azure autenticada, permisos, imágenes públicas GHCR, Neon nueva/vacía ni confirmación del usuario. No se ejecutó un despliegue real, no se alteró Neon y no se crearon recursos Azure. Windows real sigue pendiente de la prueba del usuario.
