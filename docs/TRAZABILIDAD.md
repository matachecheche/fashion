# Matriz de trazabilidad — FashionStore

**Actualizada:** 10-11-2026  
**Estado:** matriz de trabajo completa en IDs; **no constituye una aprobación de aceptación**. El proyecto/código del Primer Parcial se conserva como baseline, incluyendo los módulos que el esquema identifica como CU-01–CU-14. La búsqueda de Drive encontró el candidato `INF432_SE2_GXX.zip` (5,076,155 bytes; modificado 31-10-2026), pero la lectura conectada no extrae ZIP; no se inspeccionó su contenido ni se recuperaron los criterios. Por ello siguen pendientes la transcripción normativa de títulos, pre/postcondiciones y oráculos individuales. La tabla registra cobertura sin inventar relaciones ID↔flujo.

## Leyenda

- **Implementado (código):** hay lógica/rutas/UI en la rama actual; no implica despliegue o validación de aceptación.
- **Evidencia histórica:** prueba documentada del 09-11-2026 sobre el estado anterior de la rama. No traslada automáticamente la aprobación a cambios posteriores.
- **Verificado esta ronda:** comando ejecutado en este entorno 10-11-2026; solo cubre exactamente la comprobación indicada.
- **Parcial / pendiente:** funcionalidad incompleta o sin ejecución en el ambiente necesario.
- **No mapeado:** la fuente entregada no identifica el requisito o su criterio; se requiere PDF. No equivale a eliminado.

## Requisitos CU-01–CU-21

El comentario de `database/schema.sql` dice que el esquema original cubre en conjunto CU-01–CU-14 (catálogo, inventario, reservas, ventas, pagos, POS, proveedores, IA/AR, notificaciones, auditoría y roles). El propio esquema solo etiqueta explícitamente CU-04/05 y CU-07–10. El manual UI agrupa módulos, pero no aporta los títulos ni criterios individuales. No atribuir un módulo a un ID concreto sin recuperar la fuente.

| ID | Requisito literal / fuente disponible | Implementación rastreable en rama | Estado de evidencia actual |
|---|---|---|---|
| CU-01 | Nombre/pre/postcondiciones individuales no identificadas en la fuente local. | Baseline completo del Primer Parcial preservado; ver cobertura transversal por módulos más abajo. No se atribuye un módulo único a este ID. | **Funcionalidad heredada conservada; falta prueba/aceptación ID-específica.** |
| CU-02 | Nombre/pre/postcondiciones individuales no identificadas en la fuente local. | Baseline del Primer Parcial preservado; sin reasignar el ID a una pantalla o endpoint por conjetura. | **Funcionalidad heredada conservada; falta prueba/aceptación ID-específica.** |
| CU-03 | Nombre/pre/postcondiciones individuales no identificadas en la fuente local. | Baseline del Primer Parcial preservado; ver módulos y rutas existentes en el inventario transversal. | **Funcionalidad heredada conservada; falta prueba/aceptación ID-específica.** |
| CU-04 | El esquema agrupa “Reservas y Detalle de Reserva (CU-04 y CU-05)”; el título individual falta. | API `reservas`, tablas de reservas/detalle; web tienda/panel y móvil `Reservar`/`Reservas`. | **Baseline heredado presente.** Evidencia end-to-end histórica de reserva 09-11 (§11); retesteo de la rama final pendiente. |
| CU-05 | Esquema comparte la nota de reservas con CU-04; el título individual falta. | El flujo/domino de reservas del Primer Parcial se conserva en API/UI; no se inventa qué paso exacto pertenece a este ID. | **Baseline heredado presente; aceptación individual no mapeada.** Evidencia histórica del flujo general de reserva. |
| CU-06 | Nombre/pre/postcondiciones individuales no identificadas en la fuente local. | Baseline del Primer Parcial se mantiene; ver inventario de dominios transversales y código original del proyecto. | **Funcionalidad heredada conservada; falta prueba/aceptación ID-específica.** |
| CU-07 | Esquema agrupa ventas/items/pagos/devoluciones (CU-07–CU-10); título individual pendiente. | Baseline del Primer Parcial preservado: API `ventas`, checkout web/móvil, POS y sync. | **Baseline heredado presente.** Evidencia histórica de ventas/POS en UI; rama final debe revalidarse. |
| CU-08 | Mismo comentario grupal CU-07–CU-10; título y flujo exacto no detallados por ID. | Módulos heredados de ventas/pagos conservados; no se asigna una acción por suposición. | **Baseline heredado presente; aceptación individual no mapeada.** |
| CU-09 | Mismo comentario grupal CU-07–CU-10; título y flujo exacto no detallados por ID. | Módulos heredados de ventas/pagos conservados; no se asigna una acción por suposición. | **Baseline heredado presente; aceptación individual no mapeada.** |
| CU-10 | Mismo comentario grupal CU-07–CU-10; título y flujo exacto no detallados por ID. | API de devolución/estado en `ventas`, con `pagos`/inventario; la devolución completa exige pago confirmado, repone stock y registra pago/saga en sandbox o efectivo anotado. | **Baseline heredado presente; aceptación individual no mapeada.** `test:payments` pasó en PostgreSQL local (incluye reembolso sandbox idempotente y devolución con reposición de stock). Reembolso externo no implementado.
| CU-11 | Nombre/pre/postcondiciones individuales no identificadas en la fuente local. | El esquema de Primer Parcial declara en conjunto proveedores, IA/AR, notificaciones, auditoría y roles; se preservan los módulos, sin fijar un subdominio a este ID. | **Baseline heredado presente; aceptación individual no mapeada.** |
| CU-12 | Nombre/pre/postcondiciones individuales no identificadas en la fuente local. | Baseline del Primer Parcial conservado; ver inventario transversal de módulos. | **Funcionalidad heredada conservada; falta prueba/aceptación ID-específica.** |
| CU-13 | Nombre/pre/postcondiciones individuales no identificadas en la fuente local. | Baseline del Primer Parcial conservado; ver inventario transversal de módulos. | **Funcionalidad heredada conservada; falta prueba/aceptación ID-específica.** |
| CU-14 | Nombre/pre/postcondiciones individuales no identificadas en la fuente local. | Baseline del Primer Parcial conservado; ver inventario transversal de módulos. | **Funcionalidad heredada conservada; falta prueba/aceptación ID-específica.** |
| CU-15 | `README.md` menciona CU-15 en pendientes, pero no incluye el nombre ni criterio. | Existen migraciones SaaS/sync/ML y módulo de suscripción; no se asignan a CU-15 sin PDF. | **No mapeado por ID.** Migraciones 003–010 y seed se aplicaron en PostgreSQL 17.11 limpio; `test:subscription` pasó. Billing permanece sandbox. |
| CU-16 | No hay definición/criterio local. | Offline/outbox, `/sync/pull`, `/sync/push`, `/ventas/sincronizar-offline` y `/sync/resolver-conflicto`; no asignado al ID. Panel móvil con reintento/descarte y transferencia de stock antes de reintentar. | **No mapeado por ID.** `test:sync` y `test:sync-conflicts` pasaron con NestJS + PostgreSQL local, incluida persistencia/replay/resolución auditada. Falta ensayo de varios dispositivos/concurrencia real y la prueba móvil en dispositivo. |
| CU-17 | No hay definición/criterio local. | Reportes: `/reportes/dashboard`, `/reportes/ia/consultar`, exportación CSV/XLSX/PDF y entrada por dictado en el panel móvil; no asignado al ID. | **No mapeado por ID.** `test:reportes` pasó contra API/DB (consulta y firma binaria PDF/XLSX/CSV); el dictado sigue sin probarse en dispositivo y la consulta normativa exacta está pendiente. |
| CU-18 | No hay definición/criterio local. | FastAPI ML: análisis/métricas, `/ia/ml/entrenar`, `/ia/ml/modelos`, `/ia/ml/predecir-demo` y listados de predicciones; no asignado al ID. Artefactos versionados y predicciones marcadas sintéticas, con contexto tenant. | **No mapeado por ID; parcial.** `test:ml-persistence` pasó con PostgreSQL: versionado, persistencia, predicciones y aislamiento tenant-scoped. Dataset exclusivamente sintético; no es modelo operativo ni validación de calidad con datos reales. |
| CU-19 | El único ID ampliado por fuente local: `backend-nest/test/payments-saga.mjs` lo titula “QR sandbox, saga, expiración y reintento”. | API `pagos`, webhooks, pago sandbox, estados de venta/pago y `saga_pago`; compensación sandbox idempotente para pago confirmado sin venta y devolución completa con reposición de inventario. | **Identificado en el código, no aceptación oficial cerrada.** `test:payments` pasó 8/8 pasos contra API/PostgreSQL local, incluidos webhook de aprobación tardía, reembolso sandbox y devolución con stock. Sin proveedor real, settlement ni reembolso externo.
| CU-20 | No hay definición/criterio local. | App Expo y panel operativo móvil sobre endpoints; incluye dictado para consultas, conflicto con reintentar/descarte, compensación sandbox y transferencia de stock entre almacenes; no asignado al ID. | **No mapeado por ID; parcial.** Typecheck/export, Expo Doctor 18/18 y prebuild Android pasan; no hay emulador/APK, prueba de voz/dispositivo ni paridad funcional completa. |
| CU-21 | No hay definición/criterio local. | La rama incluye SaaS, RLS, reportes, ML, operaciones móviles y despliegue/configuración; no asignado al ID. | **No mapeado; no cerrado.** Requiere PDF y prueba de aceptación correspondiente. |

### Cobertura funcional transversal (no reemplaza el mapeo CU)

| Dominio | Rutas / artefactos de backend rastreados | Web | Móvil | Evidencia y brecha principal |
|---|---|---|---|---|
| Identidad, roles, tenant | `auth`, `tenants`, `JwtTenantGuard`, contexto tenant y middleware | Login/registro, perfil, roles | Auth, Cuenta, onboarding | En DB limpia, `test:smoke` y `test:ml-persistence` validaron alta/aislamiento de tenant y rechazo de token cruzado. No sustituye auditoría completa de RLS/roles/ownership. |
| Catálogo y variantes | `catalogo` productos, variantes, disponibilidad; `maestros` categorías/temporadas/colecciones | Catálogo, detalle, panel de productos/maestros | Catálogo, Producto | `test:smoke` pasó en esquema 10 y verifica catálogo/tenant nuevo. No es una regresión de todos los flujos del catálogo. |
| Inventario/sucursales | `inventario`, `maestros`, transferencias/recepciones/alertas | Panel inventario | Panel operativo y formulario de transferencia entre almacenes con validación de variante/cantidad | Suite de conflicto probó reposición auditable antes de reintentar; transferencia móvil entre almacenes no se probó en dispositivo. |
| Reservas | `reservas` crear, listar, preparar, confirmar, finalizar/cancelar | Tienda + cola panel | Reservar/Reservas/Panel | Se conserva la evidencia histórica E2E; las suites nuevas no equivalen a revalidar todas las transiciones de reserva. |
| Ventas, POS, entrega, devolución | `ventas`, `pos`, inventario/stock | Checkout, panel POS/ventas | Checkout/Pago/Pedidos/Panel POS | `test:payments` validó devolución completa y reposición de stock en PostgreSQL; UI E2E de POS/entrega sigue siendo evidencia histórica. |
| Pagos / saga | `pagos` webhooks, sandbox, conciliación y reintento; compensación sandbox y devolución completa; `saga_pago` | Checkout, pantalla pago, panel operaciones y Ventas (sagas pendientes) | Pantalla Pago, POS y panel de conflictos | `test:payments` pasó 8/8 contra API/PostgreSQL, con webhook firmado y compensación idempotente. Sandbox no mueve fondos; proveedor real no conectado. |
| Outbox / sync offline | `sync` pull/push, operaciones, ack-conflicto y resolución auditada de conflicto; venta offline idempotente | PWA/cache y POS web | SQLite/outbox; panel permite reintentar/descarte y desde Inventario transferir stock | `test:sync` y `test:sync-conflicts` pasaron en PostgreSQL. No cubren competencia multi-dispositivo/partición de red en dispositivo físico. |
| SaaS/suscripción | `tenants`, `suscripcion`, planes/cuotas/trial y migración 010 | Onboarding/plan/usuarios | Onboarding/Panel | Migraciones 003–010/seed y esquema 10 aplicados; `test:subscription` pasó. El cambio de plan sigue en sandbox, sin cobro real. |
| Reportes/exportación | `reportes` dashboard, consulta y export PDF/XLSX/CSV | Panel reportes | Panel reportes/exportación con dictado | `test:reportes` pasó contra API/DB y reconoció PDF/XLSX/CSV. La voz no se probó en dispositivo y el criterio/consulta normativos siguen pendientes. |
| IA / ML / AR | `ia` Nest proxy, FastAPI ML con entrenamiento/listado/predicción tenant-scoped y esquema de modelo/segmento/predicción | Asistente, vestidor, métricas | Asistente, ProbadorAR, Panel ML | `test:ia` pasó; `test:ml-persistence` pasó con PostgreSQL para versionado, predicciones y aislamiento. Artefactos solo sintéticos; no es ML productivo ni evaluación con datos reales. |
| Proveedores / propuestas / notificaciones | `propuestas`, `notificaciones` | Panel propuestas/campana | Panel operativo (lectura de operaciones) | Builds vigentes; no se probó flujo final completo ni integración real con proveedor tras despliegue. |
| Usuario/dispositivo móvil | React Native/Expo, secure store, SQLite y `expo-speech-recognition` | PWA React | App Android/iOS; panel móvil y dictado | Expo Doctor 18/18, typecheck, export y prebuild Android pasan; manifiesto incluye permisos/intención de voz. No hay APK, dispositivo, prueba nativa de voz ni API cloud. |

## D1–D9: control de evidencia

El texto literal de los nueve criterios no se encuentra en el repositorio ni en un archivo legible consultado. Google Drive devolvió el candidato ZIP `INF432_SE2_GXX.zip`, pero su contenido no pudo extraerse con el lector conectado; su existencia no permite citar ni validar criterios. Los estados siguientes son **control de cierre técnico**, no interpretación oficial de la calificación del PDF.

| ID | Texto normativo | Estado técnico que puede afirmarse hoy | Evidencia requerida para cerrar |
|---|---|---|---|
| D1 | No disponible en los artefactos actuales. | **Sin evaluación oficial posible.** | Incorporar el PDF maestro, transcribir criterio y umbral literalmente, ligar evidencias fechadas. |
| D2 | No disponible en los artefactos actuales. | **Sin evaluación oficial posible.** | PDF maestro + evidencia ejecutada que el criterio solicite. |
| D3 | No disponible en los artefactos actuales. | **Sin evaluación oficial posible.** | PDF maestro + evidencia ejecutada que el criterio solicite. |
| D4 | No disponible en los artefactos actuales. | **Sin evaluación oficial posible.** | PDF maestro + evidencia ejecutada que el criterio solicite. |
| D5 | No disponible en los artefactos actuales. | **Sin evaluación oficial posible.** | PDF maestro + evidencia ejecutada que el criterio solicite. |
| D6 | No disponible en los artefactos actuales. | **Sin evaluación oficial posible.** | PDF maestro + evidencia ejecutada que el criterio solicite. |
| D7 | No disponible en los artefactos actuales. | **Sin evaluación oficial posible.** | PDF maestro + evidencia ejecutada que el criterio solicite. |
| D8 | No disponible en los artefactos actuales. | **Sin evaluación oficial posible.** | PDF maestro + evidencia ejecutada que el criterio solicite. |
| D9 | No disponible en los artefactos actuales. | **Sin evaluación oficial posible.** | PDF maestro + evidencia ejecutada que el criterio solicite. |

Las brechas de PostgreSQL, Windows, Azure, APK, UI, presupuesto y documentación listadas en `AUDITORIA.md` son inventario técnico encontrado en los archivos locales; **no se atribuyen a D1–D9 en particular** hasta recuperar el texto maestro.

## T-01–T-20: escenario y automatización

El PDF de pruebas T-01–T-20 tampoco está disponible. Para evitar fabricar una correspondencia, se reserva cada ID y se registran por separado las suites reales del repo. Completar la columna “definición literal” y el enlace a prueba cuando llegue el documento.

| ID | Definición literal / oráculo | Prueba asociada | Resultado |
|---|---|---|---|
| T-01 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-02 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-03 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-04 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-05 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-06 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-07 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-08 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-09 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-10 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-11 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-12 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-13 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-14 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-15 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-16 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-17 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-18 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-19 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |
| T-20 | No disponible; falta PDF de pruebas. | **No asignada.** | Pendiente de fuente; no adjudicar suites por orden. |

### Inventario real de pruebas (no equivalencia automática a T)

- NestJS: **8 suites de integración** (`smoke`, `sync-conflicts`, `payments`, `subscription`, `sync`, `reportes`, `ia`, `ml-persistence`) pasaron en esta ronda, en secuencia sobre DB PostgreSQL 17.11 limpia; además `test:security` aislado pasó. Build y `node --check test/*.mjs` también pasaron.
- FastAPI: pytest con **8 passed** y `tests/prueba_ia.py` con **6 passed**; además sirvió de dependencia real para los tests de proxy/ML del stack integrado.
- Web: `test/pwa-offline.mjs`; UI sweep Playwright 13 rutas documentado como histórico en `VERIFICACION.md` §11, no repetido en esta ronda.
- Móvil: TypeScript, Expo Doctor, export Android y prebuild; no hay suite E2E/emulador/dispositivo.
- `verificar.bat` y CI contienen ahora `test:ml-persistence`, pero no se ejecutaron en Windows ni en GitHub Actions. Los resultados locales no son resultado de esos runners.

**Criterio de cierre:** importar PDF, transcribir las definiciones literales, asignar pruebas existentes solo tras revisar sus pre/post-condiciones, crear las pruebas faltantes, ejecutar en ambiente apropiado, adjuntar logs/artifacts y actualizar cada fila con fecha/commit. No usar un `PASS` de otra fecha o de un componente como evidencia de todo el caso.
