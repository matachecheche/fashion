# Diseño y trazabilidad ICONIX — FashionStore

**Corte:** 10-11-2026  
**Alcance de este documento:** modelos de trabajo que reflejan rutas y tablas visibles en la rama; no una certificación de requisitos del PDF que no está disponible.

## Convenciones

1. **Normativo:** los nombres y criterios CU/T vienen de los PDFs originales. No disponibles aquí. No asignamos números a los casos en los dibujos salvo la referencia de código CU-19; los actores/objetivos se nombran por dominio.
2. **Implementado:** formas/rutas/tablas que existen en el repositorio. Aun así, un diagrama no significa que la versión actual se haya ejecutado.
3. **Objetivo / pendiente:** validaciones exigidas por las restricciones del proyecto, p. ej. firma/referencia/monto/expiración de pago, se anotan como condiciones obligatorias, no como resultado ya demostrado.
4. **Base de evidencia:** `TRAZABILIDAD.md`, `AUDITORIA.md`, `DECISIONES.md` y `VERIFICACION.md` (distinguir 09-11 histórico de 10-11 actual).

## Modelos

| Artefacto | Vista ICONIX/UML | Qué muestra | Estado |
|---|---|---|---|
| `uml/casos_uso_contexto.puml` | Modelo de dominio/actores y casos de uso | Objetivos principales por rol y límites de la app SaaS | Conceptual; faltan los nombres/relaciones oficiales de CU-01–CU-21. |
| `uml/robustez_sync_offline.puml` | Robustez (boundary-control-entity) | POS local, outbox, API, idempotencia y resolución de stock | El panel móvil permite reintentar/descartar; Inventario permite transferir stock. La verificación multi-dispositivo con DB actual sigue pendiente. |
| `uml/secuencia_sync_offline.puml` | Secuencia | Replay, mismatch de payload, transacción de stock o conflicto | Regresión `sync-conflicts.mjs` escrita y parseada; integración final requiere API/PostgreSQL y caso multi-dispositivo. |
| `uml/secuencia_pago_sandbox.puml` | Secuencia | Checkout, confirmación de proveedor, estados y saga ante venta imposible | Condiciones de firma/referencia/monto/expiración son requisitos de prueba. No representa un gateway real conectado. |
| `uml/modelo_dominio.puml` | Diagrama de clases / modelo de dominio | Tenant, usuario, producto, venta, pago, sync, suscripción y ML | Modelo lógico parcial; no sustituye el ERD generado de PostgreSQL vigente. |

## Correspondencia al método ICONIX

1. **Requisitos:** importar el PDF maestro y Segundo Parcial; copiar CU-01–CU-21 y D1–D9 a `TRAZABILIDAD.md` literalmente; asegurar pre/postcondición y excepción de cada CU.
2. **Modelo de dominio:** revisar `modelo_dominio.puml` contra `database/schema.sql`, todas las migraciones y el diagrama real de PostgreSQL aplicado; anotar PK/FK/RLS y cardinalidades confirmadas.
3. **Modelo de casos de uso:** reemplazar objetivos genéricos por CU oficiales y enlazarlos a roles, pantallas, controladores y pruebas T.
4. **Análisis de robustez:** elaborar una robustez por CU priorizado (Boundary–Control–Entity), incluidos caminos de error, permisos, tenant y rollback.
5. **Diagramas de secuencia:** generar secuencias por camino feliz/error. Ejecutarlas con un test que demuestre exactamente los mensajes/efectos.
6. **Diseño:** actualizar clases/repositorios/API a partir de los modelos; no tratar el dibujo como fuente autónoma del comportamiento.
7. **Verificación:** renderizar los `.puml`, revisar visualmente; ligar cada elemento a archivo/ruta/test y registrar fecha, entorno, resultado y artefacto.

## Render y verificación

- Se descargó PlantUML **1.2026.9** en `/tmp` solo para esta revisión; no se incluyó el JAR en el repositorio ni en el ZIP.
- `java -jar /tmp/plantuml.jar -checkonly docs/uml/*.puml` terminó con código **0**.
- `java -jar /tmp/plantuml.jar -Playout=smetana -tsvg -o rendered docs/uml/*.puml` generó 5 SVG en `docs/uml/rendered/` sin depender del ejecutable Graphviz `dot`.
- `xml.etree.ElementTree` verificó los cinco SVG como XML bien formado en el corte actual.
- Para regenerar con un JAR local compatible: `java -jar plantuml.jar -checkonly docs/uml/*.puml` y luego `java -jar plantuml.jar -Playout=smetana -tsvg -o rendered docs/uml/*.puml`. Las fuentes `.puml` son la fuente editable; los SVG son derivados.

## Limitaciones abiertas

- No se transcribió el detalle de CU-01–CU-14 ni el mapa completo de D1–D9/T-01–T-20 porque las fuentes no están disponibles.
- Renderizar UML solo valida la sintaxis/layout del diagrama; no demuestra el comportamiento de la rama ni acepta los requisitos CU/T que faltan.
- El diagrama de pagos separa explícitamente el diseño requerido (validar firma, referencia, importe y expiración) del sandbox actual. La conciliación/reembolso externo y la saga productiva quedan fuera de la evidencia local.
- El diagrama offline refleja la UI móvil añadida para reintentar/descartar y el traslado de stock desde Inventario; no certifica el flujo sobre PostgreSQL actual ni la prueba multi-dispositivo.
