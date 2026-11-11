# Asistente inteligente FashionStore (web + móvil)

## Objetivo

El asistente es una función transversal de FashionStore. La aplicación web y la aplicación móvil utilizan el mismo endpoint `POST /api/ia/chat` de NestJS; por tanto, comparten reglas, contexto de negocio, proveedor generativo y controles de autorización. No hay una conexión PostgreSQL desde el navegador ni desde el teléfono.

## Arquitectura de la consulta

1. El usuario escribe una pregunta desde la web o la app móvil.
2. NestJS identifica el tenant desde `TenantContext` y obtiene la identidad/rol/sucursal/proveedor del JWT validado. No acepta `tenant_id`, usuario, rol ni alcance de sucursal enviados libremente en el cuerpo del chat.
3. NestJS abre una transacción PostgreSQL de solo lectura, con el aislamiento RLS y el rol de lectura configurado. Consulta catálogo, variantes, existencias, sucursales, promociones, planes, agregados operativos y, cuando la pregunta lo requiere, registros de los conjuntos de datos permitidos.
4. El contexto se filtra por tenant y por el alcance del rol. Se eliminan campos sensibles y patrones de claves/tokens antes de enviar datos al servicio de IA.
5. NestJS envía a FastAPI el contexto y la pregunta mediante una llamada interna autenticada con `IA_INTERNAL_KEY`.
6. FastAPI compone el prompt con la guía funcional del proyecto (`app/knowledge.py`) y el contexto vivo de PostgreSQL (`CONTEXTO_JSON`). Las preguntas de análisis o diagnóstico sobre un pedido, pago, reserva, sincronización u otro módulo incluyen los registros autorizados pertinentes para que el modelo pueda razonar sobre ellos. Groq se intenta primero y Gemini actúa como proveedor alternativo cuando ambas claves están configuradas. Sin un proveedor válido se utiliza el modo local determinista, que muestra los datos recuperados y responde las consultas que tengan una regla local.
7. La respuesta vuelve a la misma interfaz. Web y móvil muestran el proveedor utilizado y si se consultó la base de datos, junto con las fuentes disponibles.

## Fuentes de datos consultables

La capa de consulta tiene proyecciones SQL explícitas de solo lectura. Actualmente abarca:

- Catálogo: productos, variantes/SKU, tallas, colores, precios, categorías, temporadas y colecciones.
- Disponibilidad: inventario, stock físico, reservas de unidades, stock disponible, mínimos, almacenes y sucursales.
- Actividad comercial: ventas/pedidos, artículos vendidos, reservas/citas, pagos y devoluciones.
- Operación interna: recepciones, proveedores, cajas POS, movimientos de inventario, cuentas por cobrar y abonos.
- SaaS y operación técnica: suscripciones y solicitudes de plan, operaciones offline, conflictos, dispositivos de sincronización, cambios del feed de catálogo, estados de idempotencia, webhooks y sagas de pago.
- Gestión y analítica: auditoría sin IP ni contenido sensible, modelos y predicciones ML, segmentos agregados, reportes, notificaciones y métricas agregadas de actividad de IA.

La IA no recibe todos los campos de todas las tablas. Cada conjunto devuelve solamente columnas aprobadas para ese caso de uso. Si una pregunta requiere una tabla o un campo que aún no esté en el registro de consultas, el asistente debe indicarlo y no inventar un resultado. Para agregar una fuente nueva se debe añadir una consulta parametrizada, su regla de selección por rol, su resumen de respuesta y sus pruebas.

## Reglas de acceso

| Rol | Alcance principal |
|---|---|
| Visitante | Catálogo y otra información marcada como pública; no ve métricas comerciales privadas. |
| Cliente | Sus propios pedidos/ventas, reservas, pagos y notificaciones. |
| Proveedor | Sus propias propuestas y notificaciones. |
| Cajero | Información operativa autorizada de su sucursal y operaciones offline propias. |
| Encargado / administrador | Datos operativos y métricas de su tenant. |

Las consultas de clientes y proveedores requieren el identificador correspondiente derivado del JWT. Los cajeros deben tener sucursal asignada para obtener filas de datos restringidos por sucursal. Un contexto ausente o una identidad incompleta nunca debe convertirse en una consulta sin filtro.

## Límites de seguridad

- El modelo no recibe `DATABASE_URL`, contraseña de PostgreSQL, claves Stripe, claves Groq/Gemini, tokens, hashes, claves de dispositivos, datos de autenticación, payloads crudos de pago, IP ni conversaciones privadas de terceros.
- El modelo no genera ni ejecuta SQL. No puede insertar, editar ni borrar información comercial.
- Los datos actuales del negocio salen de la consulta de NestJS; el modelo solamente los interpreta y redacta.
- La separación multi-tenant y RLS se aplican antes de llamar al proveedor generativo.
- Las descripciones y nombres de productos son datos no confiables, no instrucciones para el modelo.
- Las operaciones de pago permanecen en el modo sandbox/demo descrito por el proyecto; el chat no confirma pagos ni realiza reembolsos.

## Configuración de los proveedores

Configura las claves únicamente en el entorno del backend FastAPI. No las pongas en `frontend-web`, `mobile-app`, variables públicas `VITE_*`, `EXPO_PUBLIC_*`, repositorios ni código de la app.

Variables de FastAPI:

```dotenv
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AQ....
GROQ_MODEL=auto
GEMINI_MODEL=auto
IA_INTERNAL_KEY=REPLACE_WITH_SHARED_RANDOM_INTERNAL_KEY
```

Se pueden activar Groq y Gemini simultáneamente. El cliente intenta Groq primero y luego Gemini si el primer proveedor no está disponible. Si no se configura ninguna clave válida, el asistente sigue ofreciendo respuestas deterministas limitadas y consulta de datos que coincidan con sus reglas locales, pero no tendrá la misma capacidad de conversación abierta ni de explicación general que el modo generativo.

En Azure Container Apps, guarda `GROQ_API_KEY`, `GEMINI_API_KEY` e `IA_INTERNAL_KEY` como secretos de las aplicaciones backend. La misma `IA_INTERNAL_KEY` debe estar en NestJS y FastAPI. Nunca debe enviarse al frontend ni al móvil.

## Ejecución de pruebas

Desde `backend-nest`:

```bash
npm ci
npm run test:ia-context
```

Desde `backend-fastapi`:

```bash
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -p "test_*.py" -v
```

El build de NestJS compila el código del asistente y el Dockerfile de FastAPI copia todo `app/`, incluido `app/knowledge.py`.

## Ejemplos para validar

Prueba con cuentas de distintos roles y comprueba que los resultados respeten sus permisos:

- Visitante: «¿Qué tallas y colores tiene este vestido?»
- Cliente: «¿Cuál es el estado de mis pedidos?»
- Proveedor: «¿Qué pasó con mis propuestas?»
- Cajero: «¿Qué ventas y movimientos hay en mi sucursal?»
- Encargado/administrador: «¿Cómo va el negocio?», «¿Qué pagos están pendientes?», «¿Qué almacenes tenemos?», «¿Hay stock crítico?», «¿Cómo está la sincronización offline?»
- Cualquier rol: «Explícame cómo se utiliza el vestidor AR» o una pregunta general no relacionada con datos privados.
- Cliente: «Tengo un problema con mi pedido y no me aparece el pago»; el asistente recibe los pedidos/pagos propios permitidos para analizarlos.
- Encargado: «¿Por qué hay movimientos de inventario que no cuadran?»; se consulta el historial de inventario y movimientos permitido.

En cada respuesta revisa el indicador de base de datos y las fuentes consultadas. Una respuesta de conocimiento general no debe presentarse como dato verificado de la tienda.
