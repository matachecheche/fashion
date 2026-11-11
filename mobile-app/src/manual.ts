/**
 * Manual rápido por rol (offline). Mantener sincronizado con frontend-web/src/lib/manual.ts
 * y docs/MANUAL-USUARIO.md.
 */

export interface SeccionManual {
  id: string;
  titulo: string;
  resumen: string;
  pasos: string[];
}

export const MANUAL_SECCIONES: SeccionManual[] = [
  {
    id: 'multitenant',
    titulo: 'Tiendas SaaS Multi-Tenant y Trial de 14 días',
    resumen:
      'Cada tienda opera bajo /tienda/{slug} con aislamiento estricto en PostgreSQL (FORCE ROW LEVEL SECURITY).',
    pasos: [
      'Crea tu tienda desde "Crear Tienda SaaS": recibes slug, admin y Trial de 14 días (5 usuarios, 2 sucursales, 500 productos).',
      'Al vencer el Trial la tienda pasa a SOLO LECTURA: los datos no se borran y puedes exportarlos.',
      'Cambia de tienda desde Cuenta -> Tienda activa. La sesión y la cola offline son por tienda.',
    ],
  },
  {
    id: 'vestidor-ar',
    titulo: 'Vestidor Virtual AR y Talla Inteligente',
    resumen:
      'Superposición de prendas (8 tipos x 12 colores) sobre la cámara o la silueta manual, con cálculo antropométrico de talla.',
    pasos: [
      'Abre "Probador AR" desde cualquier producto o desde el menú.',
      'Si tu dispositivo tiene cámara, superpone la prenda con gestos de arrastre/pellizco. Sin cámara, usa el modo manual con escala y posición.',
      'Ingresa altura y peso para recibir la talla sugerida por el modelo antropométrico.',
    ],
  },
  {
    id: 'pagos-sandbox',
    titulo: 'Pagos en Modo Sandbox',
    resumen:
      'QR y tarjeta son sandbox: no se mueve dinero real. Las devoluciones requieren un pago confirmado y registran si la compensación fue simulada o efectivo anotado.',
    pasos: [
      'Al confirmar el pedido con QR o Tarjeta, queda en estado PENDIENTE DE PAGO.',
      'En la pantalla de Pago Sandbox puedes simular aprobación/rechazo del proveedor.',
      'Una devolución restituye inventario. Para pagos digitales solo se registra una simulación sandbox; no llama al proveedor. El efectivo queda anotado por el operador, sin verificación de entrega física.',
    ],
  },
  {
    id: 'pos-offline',
    titulo: 'Operación Offline y Sincronización',
    resumen:
      'SQLite local (expo-sqlite) guarda catálogo, carrito y cola durable con hash/idempotency key.',
    pasos: [
      'Sin conexión, las operaciones permitidas se encolan en SQLite con estado pendiente.',
      'Al reconectar, la app sincroniza con reintentos y muestra sincronizada / conflicto / rechazada / error.',
      'Reenviar con la misma clave no duplica ventas, reservas ni cobros (idempotencia en servidor).',
    ],
  },
  {
    id: 'resolucion-conflictos',
    titulo: 'Resolver conflictos de Sync y transferir stock',
    resumen: 'El personal autorizado puede revisar operaciones fallidas y revalidar stock antes de reintentar.',
    pasos: [
      'Abre Cuenta > Panel > Sync y conflictos. Admin/encargado pueden reintentar una venta con stock insuficiente o descartar la operación.',
      'Si el stock está en otro almacén, ve a Inventario y registra una transferencia de la variante; después vuelve a Sync y reintenta.',
      'Las acciones necesitan conexión y permiso del rol. Una transferencia o reintento solo se considera confirmado cuando responde la API.',
    ],
  },
  {
    id: 'reportes-voz-ml',
    titulo: 'Reportes por dictado y métricas ML demo',
    resumen: 'Dicta o escribe una consulta de reporte y revisa los modelos sintéticos de demostración.',
    pasos: [
      'En Cuenta > Panel > Reportes, escribe una consulta o pulsa “Dictar consulta”. Acepta permiso de micrófono y habla en español.',
      'El dictado requiere el módulo nativo y puede depender del idioma, servicio de reconocimiento y conectividad; la consulta al servidor necesita internet.',
      'Las métricas/entrenamientos ML disponibles son demostraciones con datos sintéticos; no representan clientes/stock reales ni deben activar decisiones comerciales.',
    ],
  },
  {
    id: 'reservas',
    titulo: 'Reservar Prendas en Sucursal',
    resumen: 'Aparta prendas para prueba física o retiro en tienda con cita de atención.',
    pasos: [
      'En el detalle del producto pulsa "Reservar en Sucursal".',
      'Elige fecha de cita; el stock queda retenido temporalmente hasta la fecha de expiración.',
      'Sigue el estado en la pestaña Reservas: pendiente → preparada → en_atencion → finalizada.',
    ],
  },
];
