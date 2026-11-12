# Progreso de cierre — FashionStore

**Última actualización:** 11 de noviembre de 2026  
**Estado global:** regresiones locales de backend y DB ejecutadas satisfactoriamente en el stack actual; la entrega sigue **incompleta frente a la aceptación normativa y los entornos pendientes**. No declarar CU-01–CU-21, D1–D9 ni T-01–T-20 aprobados.

## Alcance preservado y cambios

- El código completo del Primer Parcial se conserva como baseline: **CU-01–CU-14 no se reemplazan**. Se agregan cambios sin reasignar IDs cuando el criterio oficial no aparece en fuentes legibles.
- **Offline/sync:** resolución durable de conflictos con reintento/descarte auditado y reposición auditable; la suite de conflictos y la de pull/push pasan contra PostgreSQL. La transferencia de stock móvil está implementada, pero no se probó en dispositivo ni el flujo concurrente con varios dispositivos.
- **Pagos/saga/devolución:** corrección del parámetro PostgreSQL en saga tardía y regresión completa pasan contra DB. La compensación y devolución son sandbox: no transfieren fondos ni llaman a pasarela real; el efectivo sigue siendo registro manual.
- **ML demo:** nueva suite `test:ml-persistence` prueba con DB real persistencia/versionado de tres artefactos sintéticos, predicciones y aislamiento tenant-scoped. Todos los datos son sintéticos; no es ML operativo.
- **Arranque Windows:** dos logs muestran `express` ausente en Nest, sin pasos npm/build visibles en el segundo intento. Además de declararlo como dependencia directa y actualizar el lockfile, `iniciar.py` ahora valida con Node que Nest runtime y Express sean resolubles y repara la instalación si no lo son, aunque exista `node_modules`. Una prueba unitaria reproduce ese estado incompleto. La instalación limpia/build pasan en Linux; el arranque Windows **sigue sin confirmar**. Aplicar el paquete actualizado y reintentar con `iniciar.bat` (restaura fábrica y borra los datos previos, tal como se solicitó; `--keep-db` fue deshabilitado). El log apunta a un checkout en OneDrive: moverlo fuera y rotar `postgres` si `builds/.pg_password` llegó a sincronizarse.
- **Voz/documentación:** panel móvil y permisos Expo presentes; typecheck/export/prebuild no demuestran reconocimiento de voz en dispositivo. Trazabilidad, auditoría, progreso y diagramas se ajustaron a los resultados actuales y a los límites.
- **Fuente normativa:** Drive devolvió el archivo candidato `INF432_SE2_GXX.zip` (5,076,155 bytes, modificado 31-10-2026), pero el lector conectado no extrae ZIP. No se inspeccionó ni se importó ningún criterio desde ese archivo.

## Verificaciones ejecutadas en esta continuación

| Componente | Resultado observado | Límite |
|---|---|---|
| PostgreSQL | Clúster temporal 17.11 en `/tmp`, loopback. DB recreada; schema, migraciones 003–010 y seed aplicados con `ON_ERROR_STOP=1`; versión de esquema **10**. | No Docker/Compose ni despliegue administrado; falta auditoría exhaustiva RLS/ownership, rollback, concurrencia y multi-dispositivo. |
| NestJS + FastAPI + DB | **8/8 suites de integración PASS** en una secuencia limpia: `test:smoke`, `test:sync-conflicts`, `test:payments`, `test:subscription`, `test:sync`, `test:reportes`, `test:ia`, `test:ml-persistence`. `npm ci --legacy-peer-deps` limpio, Express 5.3.0 resoluble, build, seguridad y `node --check test/*.mjs` pasan. | Es evidencia local, no GitHub Actions ni aceptación T/CU/D. El arreglo del `express` faltante del log Windows requiere confirmación reejecutando `iniciar.bat` en Windows. |
| FastAPI | `pytest -q`: **8 passed**; `tests/prueba_ia.py`: **6 passed**; `pip-audit --strict --requirement requirements-dev.txt`: sin vulnerabilidades conocidas. | Warning deprecado Starlette/httpx; las pruebas ML Python unitarias siguen usando mocks donde corresponde. |
| Frontend web | Build y test PWA offline pasan; audit npm moderada sin vulnerabilidades conocidas en la ejecución del corte. | No se repitió sweep Playwright 13/13 de §11 sobre esta rama final. |
| Móvil Expo | Typecheck, export Android, Expo Doctor **18/18**, prebuild Android y manifiesto con permisos de audio/reconocimiento pasan. Audit high exit 0, quedan **13** avisos: 1 low y 12 moderate. | No es APK; no hubo Gradle/EAS, emulador/dispositivo, instalación ni prueba nativa de voz/cámara/transferencia. |
| UML y paquete | 5/5 fuentes PlantUML verificadas; cinco SVG renderizados y validados. `test_packaging.py` 6/6, incluido el preflight de Express faltante; ZIP/manifest regenerados: 411/411 hashes, 412 entradas, `testzip=OK`, dentro de 15 MiB. | El escáner de secretos cubre patrones conocidos; requiere revisión humana antes de compartir. |

## Evidencia histórica que se conserva

- `docs/VERIFICACION.md` §§1–3, §11 y §14 documentan ejecuciones reales del 09-11-2026 sobre el estado anterior de la rama, incluidas API/PostgreSQL, sync, sandbox y UI web/Playwright 13/13. Se conservan como historia y no se presentan como prueba del corte actual.
- §19 también queda como registro del corte previo; §20 prevalece para la verificación actual. Las pruebas integradas actuales de pagos, sync, suscripción, reportes e IA se documentan en §20.
- Los resultados actuales no sustituyen criterios oficiales, pruebas de dispositivo ni los runners de CI/Windows.

## Bloqueos para declarar la entrega terminada

1. Obtener los PDFs/fuentes oficiales del Segundo Parcial, D1–D9, CU y T-01–T-20 o extraer/revisar el ZIP candidato de Drive. No inventar mapeos; mantener CU-01–CU-14.
2. Reejecutar `iniciar.bat` en Windows para confirmar que Express ya carga; ejecutar además `verificar.bat` en Windows 10/11, el workflow real en GitHub Actions y el sweep web actual.
3. Completar pruebas RLS/ownership, rollback, concurrencia y varios dispositivos en un entorno apropiado.
4. Probar la app en dispositivo Android, incluido dictado/voz, cámara, venta, transferencias y sync; generar/instalar APK firmado si aplica.
5. Validar cloud/pasarela solo con autorización y secretos del propietario; no anunciar cobros, reembolsos o settlement reales.
6. Medir los umbrales oficiales una vez disponible el texto literal.

**Siguiente paso inmediato:** revisar con la persona responsable el contenido del ZIP normativo que Drive localizó (o recibir los PDFs extraídos) para completar la trazabilidad literal. El cierre local de integración, UML y paquete verificable ya está generado; Windows, dispositivos y servicios externos requieren sus entornos/autorizaciones.

## 2026-11-11 — Presentación ML web/móvil y compilación APK en Azure

- La página web `frontend-web/src/pages/panel/Reportes.tsx` dejó de imprimir las respuestas ML como bloques JSON. Ahora muestra métricas de clasificación, matriz de confusión, segmentos K-Means y tablas con valores legibles.
- El panel móvil `mobile-app/src/screens/Panel.tsx` dejó de serializar métricas y predicciones como texto JSON. Ahora representa indicadores, matrices resumidas, segmentos y predicciones como fichas legibles.
- Se añadió `tools/test_ui_presentation.py` para detectar regresiones de bloques `<pre>`/`JSON.stringify` dentro de vistas web y móvil.
- Se incrementó la versión móvil a `2.0.1` / Android `versionCode=21`.
- Se añadió `azure-pipelines-apk.yml`: valida la API HTTPS, ejecuta TypeScript, Expo Prebuild, Gradle `assembleDebug`, verifica el APK y publica `FashionStore-APK` como artefacto Azure Pipelines. La configuración de Azure DevOps es de una sola vez; las ejecuciones posteriores reutilizan la variable `EXPO_PUBLIC_API_URL` del grupo `fashionstore-mobile`.
- **Pruebas locales de esta revisión:** 99/99 pruebas Python; YAML válido; scripts Bash del pipeline pasan `bash -n`; sintaxis TSX/TS de los tres archivos modificados comprobada con TypeScript `transpileModule`; barrido de vistas sin `<pre>` ni expresiones JSX `JSON.stringify`.
- **Pendiente de validación externa:** este entorno no consiguió descargar npm desde `registry.npmjs.org`, por lo que no se pudo realizar `npm ci`, `tsc --noEmit` completo ni build Vite/Expo/Gradle. Tampoco se ejecutó el pipeline dentro de la organización Azure DevOps del propietario ni se instaló el APK en Android. No afirmar APK cloud generado hasta que una ejecución Azure termine correctamente y el artefacto se instale y pruebe.
- Los cambios visuales no alteran PostgreSQL, migraciones, API ni semilla. No ejecutar `RESTABLECER-DEMO` ni volver a cargar Neon por esta corrección. Para producción: reconstruir/actualizar la imagen `fashionstore-web` en GHCR; para Android: ejecutar Azure Pipeline y distribuir el APK nuevo.


## Compilación APK autónoma en Azure — corrección posterior

- El pipeline Azure anterior usaba `assembleDebug`, que no es adecuado para entregar un APK autónomo sin Metro en una app React Native/Expo.
- Se sustituyó por `:app:assembleRelease` y se añadió `mobile-app/ci/build-azure-apk.sh`.
- El build inyecta `EAS_BUILD_PROFILE=azure`, valida el healthcheck público, instala el toolchain Expo SDK 54 (Node 20.19, JDK 17, Android 36 y NDK 27.1), genera una clave temporal de pruebas y verifica firma, alineación, paquete, versionCode, bundle JS y URL de API.
- El APK se publica como artefacto `FashionStore-APK`. La firma temporal sirve para instalación de pruebas; para actualizaciones sin desinstalar debe configurarse un keystore persistente mediante las variables seguras `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD` del grupo `fashionstore-mobile`.
- Verificación local: `bash -n mobile-app/ci/build-azure-apk.sh`, parseo del YAML y 109 pruebas automatizadas superadas. La compilación Gradle real debe ejecutarse en Azure DevOps porque este entorno no puede resolver el registro npm ni tiene Android SDK instalado.

## Versión móvil 2.1.0 — Rediseño y paridad funcional

- Rediseño del sistema visual compartido, navegación adaptativa de cinco pestañas y zona segura para Android.
- Mejora de Inicio, Catálogo, Cuenta, Panel operativo y Vestidor AR; tarjetas, controles y distribuciones adaptadas al ancho del dispositivo.
- Se agregaron los módulos móviles de Maestros Comerciales y Notificaciones, junto con edición de perfil y cambio de contraseña.
- El formulario de producto del panel permite crear la variante inicial y registrar variantes adicionales.
- Se subió la versión de app a `2.1.0` y el `versionCode` base Android a `23`.
- El pipeline ahora integra explícitamente la configuración de firma release al Gradle generado por Expo y permite mantener la misma firma entre builds mediante secretos de Azure.
- La verificación local de TypeScript/Expo no pudo completarse en este entorno porque `npm ci` no terminó de instalar dependencias; el parseo TS/TSX y la sintaxis Bash sí se validaron.


## Verificación final de la entrega móvil — 11 de noviembre de 2026

- Paridad de navegación: las rutas web de tienda (inicio, catálogo, producto, vestidor, carrito, checkout, pago, autenticación, ayuda, pedidos, reservas y perfil) tienen pantallas/rutas móviles equivalentes; el panel móvil cubre dashboard, POS, ventas, reservas, inventario, productos, maestros comerciales, propuestas, reportes, suscripción, usuarios y analítica ML.
- Se amplió el detalle de pedidos con comprobante y líneas de venta; las reservas muestran las prendas asociadas y expiración. Se añadieron edición de perfil, cambio de contraseña y notificaciones.
- Suite local ejecutada en esta entrega: `tools/test_ui_presentation.py` (10/10), `tools/test_azure_apk_build.py` (10/10) y `tools/test_packaging.py` (12/12). El script Azure pasa `bash -n`; ambos YAML de CI y los JSON de configuración parsean correctamente.
- Parseo TypeScript/TSX con `transpileModule`: 28/28 archivos sin errores de sintaxis y sin imports relativos rotos. Esto no sustituye `tsc --noEmit` con todas las dependencias instaladas.
- `npm ci` no pudo terminar en este entorno porque no se pudo resolver/descargar desde `registry.npmjs.org`; por tanto no se declara typecheck integral ni compilación Gradle/Expo completada aquí. Además, no hay Android SDK ni configuración de API/keystore de la organización para producir y probar un APK real en esta sesión.
- El workflow Azure está preparado para producir `FashionStore-<versión>-<BuildId>.apk` como RELEASE autónomo, pero el propietario aún debe configurar el grupo de variables `fashionstore-mobile`, el endpoint público HTTPS de NestJS y una clave privada de firma estable, y ejecutar el pipeline dentro de su Azure DevOps.


## Versión móvil 2.2.0 — Ergonomía Android y responsive

- Se oculta la navegación inferior mientras el teclado está abierto para que no cubra formularios ni botones.
- Se respeta el inset inferior del sistema Android; la barra inferior queda separada de la navegación por gestos.
- El botón Atrás físico de Android cierra primero pantallas secundarias y regresa a Inicio antes de permitir salir.
- Se aumentaron objetivos táctiles del encabezado y se añadieron etiquetas accesibles para pestañas y controles de sincronización.
- Las listas y formularios preservan los toques al interactuar con el teclado (`keyboardShouldPersistTaps`).
- Se actualizaron los estilos responsive de la web: navegación horizontal táctil, grids de dos columnas en móviles, controles con altura mínima y mejor área segura para el asistente flotante.
- Se documentó el uso del dominio web con `/api` como URL de la app cuando el proxy Nginx de Azure está activo; el proceso de build confirma el healthcheck antes de compilar.
- La versión comercial de la app pasa a `2.2.0` y el `versionCode` base a `24`. La versión de CI mantiene la numeración automática del pipeline.

## Límites de verificación de 2.2.0

- La suite Python del repositorio se ejecuta localmente y valida regresiones funcionales, configuración y paquete.
- La comprobación TSX de sintaxis/imports se realiza sin reemplazar el typecheck estricto con dependencias instaladas.
- La compilación nativa release, firma estable y prueba en dispositivo deben confirmarse en Azure usando la API y el keystore del propietario.


## Versión móvil 2.2.2 — Diagnóstico de PostgreSQL y hotfix CI

- Se eliminó el atributo JSX duplicado `keyboardShouldPersistTaps` de la lista del asistente Android.
- Se asegura que `specificStatus` esté declarado antes de usarse en `isAssistantDetailRequest`, evitando TS2448 durante el build NestJS.
- Se alineó la versión móvil en `2.2.2` y el `versionCode` Android base en `26`.
- `GET /api/ia/estado?probar=true` puede ejecutar una prueba real de Groq y Gemini desde FastAPI a través de NestJS, con errores saneados y sin exponer claves.
- Los errores de conexión/resolución del tenant en PostgreSQL se reportan como HTTP 503 `TENANT_RESOLUTION_FAILED`, con un código diagnóstico y sin devolver credenciales.
- Se añadieron instrucciones de diagnóstico para diferenciar fallo de base de datos, resolución de tenant, proxy NestJS→FastAPI y claves del proveedor.
- Se añadió `/api/health/live` independiente de PostgreSQL y el healthcheck de readiness devuelve HTTP 503 con un código diagnóstico seguro; también rechaza `DATABASE_URL` ausente en producción. Se actualizaron las acciones del workflow a runtimes Node 24 compatibles (checkout/setup-node v7, setup-java v6, cache v6 y upload-artifact v7). Suite Python del repositorio: 121 pruebas aprobadas. El análisis del compilador no detecta TS17001, TS2448 ni TS2454 en los archivos corregidos. No se declara un `npm run build` integral local: npm ci no terminó de recuperar todas las dependencias en este entorno.


## Límites de verificación de 2.2.2

- La suite Python del repositorio pasa 120 pruebas.
- NestJS no pudo completar `npm ci`/`npm run build` en este entorno por timeout de descarga de dependencias. El CI de GitHub debe confirmar el build TypeScript real.
- El diagnóstico HTTP 503 permite identificar el problema real de PostgreSQL después de desplegar la imagen nueva; aún no se puede identificar la causa específica de la instancia Azure solo con el HTTP 500 anterior.


## Versión 2.3.0 — IA generativa real y respuestas mejoradas

- Las consultas conversacionales del catálogo, recomendaciones y análisis de negocio usan Groq/Gemini con contexto PostgreSQL verificado; los conteos exactos y listados operativos autorizados mantienen respuesta determinista.
- Se reforzó el prompt para comparaciones de prendas, recomendaciones útiles y análisis comercial basado en métricas, sin inventar datos ni romper el aislamiento multi-tenant.
- Groq prioriza GPT-OSS 120B con razonamiento alto cuando está habilitado; Gemini prioriza 3.8 Flash.
- La API devuelve proveedor, modelo y diagnósticos seguros cuando se activa el fallback local.
- La bienvenida web ya no se etiqueta erróneamente como motor local antes de enviar una consulta.
- Versión móvil 2.3.0, versionCode 27.

## Versión móvil 2.3.0 — IA generativa y diagnóstico Azure

- Las consultas conversacionales sobre catálogo, recomendaciones y estilo pasan al LLM con el contexto tenant-scoped de PostgreSQL. Conteos exactos y listados operativos con permisos permanecen deterministas.
- Se reforzó el prompt del asesor para dar recomendaciones específicas, comparar productos disponibles, razonar sobre estilo y separar datos verificados de interpretación.
- Groq prioriza GPT-OSS 120B con razonamiento alto; Gemini prioriza Gemini 3.8 Flash. La selección consulta los modelos habilitados y conserva alternativas.
- Se ampliaron los límites de generación y se añadieron diagnósticos sanitizados para claves ausentes, fallos de proveedor y proxy NestJS–FastAPI.
- Web y Android muestran proveedor/modelo y motivo del fallback; el saludo inicial web no afirma incorrectamente que el motor sea local.
- Versión móvil `2.3.0`, Android `versionCode=27`.
- Guía de publicación y actualización de revisiones Azure: `docs/IA-GENERATIVA-AZURE.md`.
