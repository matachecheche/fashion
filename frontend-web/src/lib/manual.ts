/**
 * Manual interactivo contextual por modulo y rol (CU-01 a CU-14 + Multi-Tenant SaaS)
 */

export interface SeccionManual {
  id: string;
  titulo: string;
  roles: string[];
  resumen: string;
  pasos: string[];
}

export const MANUAL_SECCIONES: SeccionManual[] = [
  {
    id: 'multitenant',
    titulo: '1. Tiendas SaaS Multi-Tenant y Trial de 14 Dias',
    roles: ['admin', 'encargado', 'cajero', 'cliente', 'proveedor'],
    resumen:
      'Cada boutique opera bajo su propio identificador (/tienda/{slug}) con aislamiento estricto en PostgreSQL (FORCE ROW LEVEL SECURITY).',
    pasos: [
      'Para dar de alta una nueva tienda, usa el boton "Crear Nueva Tienda SaaS" en la barra superior o en /registro-tienda.',
      'Toda tienda nueva recibe un Trial de 14 días con tope de 3 usuarios, 1 sucursal y 200 productos.',
      'Si el periodo Trial expira, la tienda pasa a Modo Solo Lectura: tus datos nunca se borran y puedes exportarlos en PDF, Excel o CSV.',
    ],
  },
  {
    id: 'vestidor-ar',
    titulo: '2. Catalogo Inteligente y Probador Virtual AR',
    roles: ['cliente', 'admin', 'encargado', 'cajero'],
    resumen:
      'Visualiza las 192 variantes de prendas (8 tipos x 12 colores) con superposicion AR en camara o silueta interactiva.',
    pasos: [
      'En el Catalogo o Detalle de Producto, pulsa "Probar en Vestidor AR".',
      'Puedes activar tu camara web con tracking corporal o usar el modo de calibracion manual (escala y posicion X/Y) si no dispones de camara.',
      'Usa el calculador antropometrico (altura y peso) para recibir recomendacion instantanea de talla.',
    ],
  },
  {
    id: 'pagos-sandbox',
    titulo: '3. Checkout y Pasarelas de Pago en Modo Sandbox',
    roles: ['cliente', 'admin', 'encargado', 'cajero'],
    resumen:
      'Regla de honestidad transaccional: ningún pago QR o tarjeta se marca como pagado hasta recibir confirmacion verificable del proveedor sandbox.',
    pasos: [
      'Al confirmar un pedido con QR Libelula Sandbox o Tarjeta Stripe Sandbox, el pedido queda en estado PENDIENTE DE PAGO / NO CONFIRMADO.',
      'En la pantalla de Pago Sandbox puedes simular la aprobacion o rechazo del proveedor y verificar como el stock retenido pasa a venta firme o se libera. Es una demo: no se mueve dinero real.',
    ],
  },
  {
    id: 'pos-offline',
    titulo: '4. Punto de Venta (POS) Offline-First y Resolucion de Conflictos',
    roles: ['admin', 'encargado', 'cajero'],
    resumen:
      'El POS funciona incluso sin conexion a internet almacenando operaciones en IndexedDB con clave idempotente y hash SHA-256.',
    pasos: [
      'El POS detecta la conectividad real; sin conexión permite encolar ventas en efectivo en IndexedDB y bloquea pagos QR/tarjeta.',
      'Al reconectar, usa "Sincronizar Cola Offline"; la cola durable envía cada operación con clave idempotente y recibe su resultado del servidor.',
      'Si dos cajeros vendieron la ultima unidad estando offline, la primera venta se confirma y la segunda queda marcada como CONFLICTO DE STOCK para resolucion asistida.',
    ],
  },
  {
    id: 'reportes-ia-ml',
    titulo: '5. Reportes por Voz/Texto y Ciencia de Datos (ML)',
    roles: ['admin', 'encargado'],
    resumen:
      'Genera reportes mediante comandos en espanol (texto o microfono) y exportalos en PDF, Excel (.xlsx) y CSV seguro.',
    pasos: [
      'En /panel/reportes escribe o dicta por voz tu consulta (ej. "Stock critico por sucursal" o "Ventas confirmadas del mes").',
      'Descarga el resultado real en PDF, Excel (.xlsx) o CSV protegido contra inyeccion de formulas.',
      'En la app móvil (Panel > ML) puedes entrenar/listar modelos demo y guardar predicciones por tenant con datos sintéticos reproducibles. No son datos reales ni decisiones comerciales; un ciclo productivo requiere validación y gobierno adicionales.',
    ],
  },
];
