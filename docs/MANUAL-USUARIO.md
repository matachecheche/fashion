# Manual de uso — FashionStore

**Alcance:** guía de las funciones visibles en esta rama. El código completo del Primer Parcial (CU-01–CU-14) se conserva como baseline; esta guía no sustituye los criterios oficiales del Segundo Parcial ni confirma aceptación normativa.

## Tienda, cuenta y roles

- El usuario inicia sesión en la tienda correspondiente. La API determina el tenant a partir del token/contexto del servidor; no se debe cambiar manualmente un `tenant_id` en una petición.
- El panel operativo se muestra de acuerdo con el rol. Las acciones de pagos, transferencias, conflictos, reportes y ML pueden exigir permisos de `admin` o `encargado`.
- Mantén el dispositivo conectado al servicio esperado y no compartas credenciales ni tokens.

## Checkout, pagos y devoluciones

1. Al crear una compra con QR o tarjeta, la venta queda pendiente hasta que el flujo Sandbox reciba una confirmación admisible. Una pantalla de “aprobado” en FashionStore no equivale a settlement bancario.
2. El modo QR/tarjeta actual es una demostración. La aprobación Sandbox no acredita que una pasarela real cobró fondos.
3. Si un pago digital queda confirmado y la venta no puede finalizarse, el panel de Ventas/Sync muestra la saga para revisión. “Registrar reembolso sandbox” actualiza los estados de la demo y la saga, pero **no transfiere dinero ni llama a Stripe/LIBELULA**.
4. Para devolver una venta, el backend exige venta pagada/entregada y un único pago confirmado que coincida con el total. La ruta registra la devolución y repone inventario. En pago digital registra una compensación sandbox simulada; en efectivo deja constancia del operador, sin verificar que el efectivo se entregó físicamente.
5. No uses esas operaciones para conciliar dinero real. No hay adaptador real de reembolso conectado.

## POS offline, sync y conflictos

- La app móvil mantiene operaciones locales en SQLite; el POS web mantiene su propia cola offline. Al recuperar conexión, sincroniza con claves idempotentes para evitar duplicados.
- En la app, abre **Cuenta > Panel > Sync y conflictos**. Admin/encargado pueden reintentar una venta cuando el servidor vuelva a validar stock o descartar una operación tras confirmar la decisión.
- Si la variante está en otro almacén, abre **Inventario**, elige almacén origen/destino y registra una transferencia. Luego vuelve a Sync para reintentar. El éxito depende de la respuesta de la API y de los permisos/stock actuales.
- No asumas que un conflicto se resolvió solo porque se encoló el reintento. Confirma el estado final y el comprobante tras sincronizar.
- El caso con dos dispositivos vendiendo la última unidad debe probarse sobre un stack PostgreSQL actual; este manual no certifica esa concurrencia.

## Reportes por voz y texto

- En la app móvil, abre **Cuenta > Panel > Reportes**. Escribe la consulta o usa **Dictar consulta**; revisa el texto transcrito antes de enviar.
- Se requiere permiso de micrófono y una build nativa con `expo-speech-recognition`; el funcionamiento puede depender del idioma/servicio instalado y conectividad del dispositivo. La consulta al backend requiere internet.
- Las exportaciones PDF, XLSX o CSV dependen del endpoint y permisos disponibles. Valida los totales antes de usarlos en decisiones contables.

## ML de demostración

- **Cuenta > Panel > ML** permite consultar métricas y generar artefactos/predicciones demo tenant-scoped.
- Los datos de entrenamiento/predicción son **sintéticos, reproducibles y marcados como demo**. No describen clientes ni inventario reales; no habilitan campañas, precios o reposiciones automáticas.
- La escritura en PostgreSQL/RLS requiere migración y pruebas en el entorno desplegado. No se debe tratar un resultado local o mock como validación de persistencia productiva.

## Límites de esta entrega

- No hay adaptador de reembolso/settlement de proveedor real.
- La integración final de nuevas rutas con PostgreSQL, el escenario de varios dispositivos, el dictado en Android/iOS y la instalación de APK necesitan sus respectivos entornos y pruebas.
- Para el estado de verificación, los resultados reproducibles y las brechas, consulta `VERIFICACION.md`, `AUDITORIA.md`, `TRAZABILIDAD.md` y `PROGRESO.md`.
