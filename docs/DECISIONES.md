# Registro de decisiones técnicas y alcance — FashionStore

**Fecha de actualización:** 10 de noviembre de 2026  
**Principio:** priorizar los requisitos verificables de las instrucciones maestras; no llamar terminado a un requisito cuya prueba no se haya ejecutado en el entorno apropiado.

## ADR-001 — Preservar el proyecto del Primer Parcial (CU-01–CU-14)

**Decisión:** el código y los módulos heredados del Primer Parcial que están en este proyecto se consideran el baseline a preservar y mantener funcionando; no se eliminan ni se sustituyen por el alcance nuevo. `database/schema.sql` declara que cubre CU-01–CU-14 y la implementación actual incluye esos dominios (cuentas/roles, catálogo, inventario, reservas, ventas/POS, proveedores, IA/AR, notificaciones y reportes). La falta de un documento con los títulos individuales no significa que el proyecto del Primer Parcial no se haya entregado ni que haya que reconstruirlo.

**Límite de trazabilidad:** las fuentes locales etiquetan explícitamente el grupo CU-01–CU-14 y algunos subgrupos, pero no cada ID con su pre/postcondición y oráculo. Por eso `TRAZABILIDAD.md` registra la cobertura heredada y la conserva; solo la correspondencia exacta ID↔flujo y su aceptación individual quedan sin mapear. No inventar una especificación que el código/documentos no dicen.

**Para cerrar:** mantener las funciones del Primer Parcial intactas, completar sobre ellas el alcance del Segundo, y si se requiere calificar cada ID exactamente, adjuntar la lista normativa de CU y mapearla contra los flujos ya existentes.

## ADR-002 — Hash SHA-256 y ZIP compacto

**Decisión:** `tools/paquetizar_proyecto.py` es el generador único de `manifest.sha256` y `proyecto.zip`; el ZIP tiene una raíz `fashionstore/`, metadatos de archivo reproducibles y presupuesto de 15 MiB. Omite dependencias npm, builds, entornos virtuales, archivos `.env` reales, credenciales/llaves, bases locales y capturas. Incluye fuentes, migraciones, scripts, assets de runtime, `.env.example`, fuentes `.puml` y SVG derivados.  
**Motivo:** mantener un artefacto auditable, transferible y sin secretos ni builds locales voluminosos.  
**Verificación:** `python tools/verificar_manifiesto.py --zip` comprueba hashes de archivos locales y del ZIP, integridad, entradas faltantes/extra, rutas/nombres/extensiones prohibidas y marcadores comunes de llaves privadas/tokens/URLs con contraseña. No puede detectar toda forma de secreto ofuscado; requiere revisión humana adicional. Ejecutar después de toda modificación.

## ADR-003 — No tratar export Expo como APK

**Decisión:** el resultado confirmado (`expo export --platform android`) es un bundle JS/Hermes `.hbc`, no instalador Android. El README/documentos deben identificarlo así; no se declara una app instalable hasta que EAS/Gradle compile un `.apk` y este se instale en un dispositivo o emulador.

## ADR-004 — Pagos, saga y sandbox honestos

**Decisión:** conservar explícito el modo QR/sandbox existente, sin representarlo como un cobro bancario. Para pruebas de pago, validar firma, referencia/nonce, monto, estado y vencimiento antes de acreditar. No incluir secretos de gateway en repositorio/logs. La aprobación de pago en BD no prueba settlement, reembolso externo o comportamiento del proveedor. Se añadió una compensación idempotente marcada como `sandbox_simulado` para un pago confirmado sin venta, y la devolución completa de una venta registra inventario/pago/saga; ambas son registros demo, no transferencias. Para efectivo se anota la intervención del operador sin verificar entrega física. No existe adaptador de reembolso real; conectores de producción quedan pendientes de credenciales autorizadas y callbacks sandbox reales. Las regresiones están escritas y parseadas, pero necesitan API/PostgreSQL para ejecutarse.

## ADR-005 — Migración de dependencias Expo sin downgrade

**Decisión:** mantener Expo SDK 54. Actualizar Metro 0.83.3→0.83.8 en la misma línea y `metro-config`/`metro-resolver`/`metro-runtime` coordinadamente para resolver la dependencia vulnerable sin bajar SDK. Evitar `npm audit fix --force`: la propuesta era un downgrade incompatible a Expo 52. Los advisories low/moderate restantes se registran, no se esconden; aplicar la próxima actualización compatible publicada por Expo en su conjunto coordinado y volver a typecheck/exportar.

## ADR-006 — Evidencia local no equivale a producción

- Un audit de `requirements-dev.txt` demuestra ausencia de advisories en la resolución auditada actual; no certifica que todas las combinaciones de runtime/CI estén idénticas.
- Una migración analizada con parser no ha sido ejecutada en PostgreSQL.
- Código de CI no equivale a workflow ejecutado.
- Script `.bat` revisado en Linux no equivale a corrida en Windows.
- Export web/app no equivale a barrido visual o dispositivo real.
- Código de despliegue/preflight no equivale a recursos provisionados ni URLs probadas.
- Una respuesta aprobada del webhook de pago no equivale a cobro real ni compensación del proveedor.
- Un SVG de PlantUML correctamente renderizado no demuestra que el modelo coincida con los CU del PDF ni que el comportamiento se haya probado.

## ADR-007 — Cliente PostgreSQL y RLS

**Decisión:** el rol de aplicación no debe ser superuser, `BYPASSRLS` ni dueño de tablas; las operaciones de negocio deben ejecutarse en una transacción con contexto `SET LOCAL` tenant/request y cancelar si falta tenant.  
**Evidencia pendiente:** inspección de rol, aplicación real de la migración, acceso cruzado con tenants A/B, acceso sin contexto, conexiones del pool y validación tras rollback.

## ADR-008 — No inventar la matriz ausente

**Decisión:** no asignar títulos, pre/postcondiciones ni resultados de D1–D9 o T-01–T-20 sin el PDF maestro, y no reconstruir los detalles de CU-01–CU-14 sin el PDF del Segundo Parcial. En `TRAZABILIDAD.md` se conserva una fila por ID y se dejan explícitamente “no mapeado”/“no asignado”. La evidencia de suites reales se mantiene en un inventario separado.

**Motivo:** preservar todas las IDs y la funcionalidad existente sin fabricar el criterio de aceptación ni aparentar aprobación.
