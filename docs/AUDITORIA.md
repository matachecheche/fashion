# Auditoría de alcance y evidencia — FashionStore

**Fecha de corte:** 10 de noviembre de 2026  
**Estado global:** cierre técnico local mejorado, pero **no cerrado** frente a D1–D9, CU-01–CU-21 y T-01–T-20. No declarar aprobado ni terminado el proyecto contra criterios oficiales aún no transcritos.

## Calidad de la fuente de aceptación

Se preserva el proyecto completo del Primer Parcial como baseline: el esquema y la documentación local agrupan CU-01–CU-14, sin sustituir ese alcance. No se reasignan ID↔flujo cuando las fuentes no lo identifican.

La búsqueda de Google Drive localizó un candidato, `INF432_SE2_GXX.zip` (5,076,155 bytes; modificado 31-10-2026), por términos del Segundo Parcial/D8. El lector conectado no extrae ZIP y el contenido no se inspeccionó. Por tanto, no se transcribieron criterios, no se da por revisado el archivo y no se declaran conformidades D/CU/T. Hace falta recibir los PDFs o el contenido extraído de ese ZIP para completar la matriz normativa.

El repo sí identifica CU-19 en `backend-nest/test/payments-saga.mjs`; el resto de criterios se conserva como no mapeado cuando el texto literal no está disponible. `TRAZABILIDAD.md` contiene la matriz y el inventario de pruebas sin adjudicar IDs por orden o conjetura.

## D1–D9: control de fuente

Los nueve textos oficiales no se han podido inspeccionar. Los estados de esta auditoría son **control de evidencia técnica**, no interpretación ni aprobación de la calificación.

| ID | Texto de aceptación | Estado |
|---|---|---|
| D1–D9 | Pendiente de PDF/fuente legible. | No evaluable contra criterio oficial; no asignar PASS individual. |

## Evidencia local revalidada — 10-11-2026

- **PostgreSQL 17.11:** binarios temporales bajo `/tmp`; servicio solo en loopback. Base `fashionstore` recreada; `database/schema.sql`, migraciones `003`–`010` y `database/seed.sql` aplicados con `ON_ERROR_STOP=1`; `public.meta` confirma esquema versión 10. Esto es una instancia temporal local, no Docker ni despliegue.
- **NestJS:** Node 22.23.4; `npm ci --legacy-peer-deps` limpio, build, seguridad de bootstrap y `node --check test/*.mjs` pasan; Express 5.3.0 resuelve desde la raíz y `npm audit --audit-level=moderate --omit=dev` informa 0 vulnerabilidades. Corregidos `$4::varchar` en conflictos y `$2::text` en la saga de aprobación tardía. Se agregó `test:ml-persistence` a CI y `verificar.bat`.
- **Arranque Windows reportado por el usuario:** dos corridas terminaron con `PackageLoader: The "express" package is missing`; en la segunda no aparecieron pasos de instalación npm/build. Además de declarar `express` `^5.3.0` en `backend-nest/package.json` y lockfile, `iniciar.py` ahora valida con Node la resolución real de los paquetes Nest runtime y Express; si falta alguno, instala aunque ya exista `node_modules`. Un test sintético verifica el caso de carpeta presente y Express no resoluble. Esta es una corrección del preflight, **no** una confirmación del arranque Windows; falta reemplazar la copia y reejecutar `iniciar.bat` (modo fábrica, elimina los datos previos; `--keep-db` quedó deshabilitado). La ruta del log está bajo OneDrive, por lo que las contraseñas locales en `builds/` pueden sincronizarse; `.gitignore` y el filtro del ZIP no controlan OneDrive. Se recomienda mover el checkout fuera de la carpeta sincronizada y rotar `postgres` si el archivo ya se subió.
- **Integración real NestJS + FastAPI + PostgreSQL, DB limpia:** **8/8 suites PASS** en secuencia: `test:smoke`, `test:sync-conflicts`, `test:payments`, `test:subscription`, `test:sync`, `test:reportes`, `test:ia`, `test:ml-persistence`. La prueba de ML verifica versionado, escritura/lectura de modelos y predicciones sintéticos, y aislamiento entre tenants. `test:payments` incluye aprobación tardía, reembolso sandbox idempotente y devolución completa con reposición de stock. No son pruebas de T-01–T-20 porque falta su definición.
- **FastAPI unit/funcional:** `pytest -q` **8 passed**; `tests/prueba_ia.py` **6 passed**; `pip-audit --strict --requirement requirements-dev.txt` sin vulnerabilidades conocidas en esa resolución. Sigue un warning deprecado Starlette/httpx.
- **Web:** build y prueba PWA offline pasan; auditoría npm moderada sin vulnerabilidades reportadas en el corte anterior de esta misma ronda. El sweep Playwright 13/13 pertenece al histórico de §11; no se repitió.
- **Móvil:** typecheck, export Android, Expo Doctor 18/18 y prebuild Android pasan; manifiesto incluye permiso de audio/servicio de reconocimiento. `npm audit --audit-level=high` exit 0, quedan 13 avisos (1 low, 12 moderate). No es APK ni acredita voz/dispositivo.
- **PlantUML:** los cinco diagramas fuente se actualizaron para reflejar las regresiones de pagos, conflictos y el esquema 10; `-checkonly` y el render Smetana pasaron, y los cinco SVG se validaron como XML.
- **Empaquetado:** `tools/test_packaging.py` pasó **6/6**, incluido el preflight que detecta Express no resoluble con `node_modules` existente. `proyecto.zip` y `manifest.sha256` regenerados tras la corrección: **411/411** hashes, **412** entradas y `testzip=OK`, sin hallazgos de rutas/nombres ni patrones comunes de secretos, bajo 15 MiB.

## Límites técnicos vigentes

No se ejecutaron GitHub Actions ni `verificar.bat` en Windows. No hay `cmd.exe`/PowerShell, Docker/Compose, ADB/emulador/EAS, APK firmado, dispositivo de voz, Azure/Neon autenticado ni pasarela real. La prueba PostgreSQL fue contra un clúster temporal local, no un servicio administrado ni un ensayo de concurrencia multi-dispositivo. No se repitió el UI sweep sobre la rama final.

## Brechas de producto y validación

1. **Pagos:** ocho pasos de saga pasan en sandbox local. No hay proveedor real, settlement ni reembolso externo; el sandbox no mueve fondos. Efectivo es constancia manual no verificada.
2. **Offline/sync:** `test:sync` y `test:sync-conflicts` pasan contra DB; no se ensayaron dos dispositivos físicos concurrentes ni particiones prolongadas de red.
3. **ML:** la persistencia y el aislamiento se probaron con PostgreSQL, pero todos los datasets/modelos/predicciones son sintéticos de demostración; no son predicción operativa ni evaluación con datos reales.
4. **Voz/móvil:** permisos y bundle se verificaron; no se probó reconocimiento de voz, cámara, transferencia o venta en dispositivo/emulador; export no equivale a APK.
5. **Trazabilidad:** D1–D9/T-01–T-20 y la relación de CU no se pueden aprobar hasta leer la fuente normativa. El ZIP hallado en Drive requiere extracción/revisión humana.
6. **Seguridad/producción:** audit de dependencias no sustituye auditoría completa de políticas RLS/ownership, privacidad, configuración tras proxy, secretos ni proveedor de pagos.

## Evidencia restante para elevar a terminado

1. Obtener y transcribir literalmente los PDFs/fuentes del Segundo Parcial, D1–D9, CU-01–CU-21 y T-01–T-20; asignar pruebas solo tras comparar oráculos y pre/postcondiciones.
2. Ejecutar workflow CI en GitHub y `verificar.bat` en Windows 10/11; correr el UI sweep actual.
3. Validar RLS/roles/ownership de forma exhaustiva y pruebas adicionales de concurrencia, rollback, modo fábrica y multi-dispositivo.
4. Ejecutar app nativa en dispositivo, probar voz/venta/sync/cámara/transferencias y producir/instalar APK firmado si el criterio lo requiere.
5. Solo con autorización y secretos del propietario, validar despliegue HTTPS y callbacks/settlement/reembolsos reales.
6. Medir umbrales normativos cuando se recupere la definición exacta; verificar y conservar artefactos y hashes finales.

El registro de comandos está en `VERIFICACION.md`; matriz en `TRAZABILIDAD.md`; decisiones en `DECISIONES.md`; siguientes pasos en `PROGRESO.md`.
