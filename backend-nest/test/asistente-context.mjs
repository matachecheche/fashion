import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  assistantContextSources,
  assistantSuggestedProducts,
  buildAssistantLocalReply,
  inferAssistantFilters,
} = require('../dist/ia/asistente-context.js');
const {
  assistantAvailableBusinessSources,
  loadAssistantBusinessDetails,
  sanitizeAssistantContext,
  selectAssistantDetailDatasets,
} = require('../dist/ia/asistente-data-context.js');

console.log('=== IA context: inferencia de filtros ===');
assert.deepEqual(inferAssistantFilters('¿Cuántas prendas rojas hay en talla M?'), {
  tipo_prenda: null,
  color: 'rojo',
  talla: 'M',
  terminos: [],
});
assert.deepEqual(inferAssistantFilters('¿Cuántos vestidos negros talla S tienes?'), {
  tipo_prenda: 'vestido',
  color: 'negro',
  talla: 'S',
  terminos: [],
});
assert.deepEqual(inferAssistantFilters('¿Cuántas prendas hay en total?'), {
  tipo_prenda: null,
  color: null,
  talla: null,
  terminos: [],
});
assert.deepEqual(inferAssistantFilters('Busco una blusa de seda imperial'), {
  tipo_prenda: 'blusa',
  color: null,
  talla: null,
  terminos: ['seda', 'imperial'],
});

const context = {
  base_datos_disponible: true,
  actualizado_en: '2026-11-10T12:00:00.000Z',
  tienda: { slug: 'demo', nombre: 'Boutique Demo' },
  acceso: { rol: 'anonimo', puede_consultar_metricas_comerciales: false },
  catalogo: {
    resumen_total: {
      productos_activos: 8,
      variantes_activas: 24,
      unidades_fisicas: 253,
      unidades_reservadas: 17,
      unidades_disponibles: 236,
      productos_con_stock: 8,
      categorias_activas: 4,
      temporadas_activas: 2,
      colecciones_activas: 3,
    },
    productos_relevantes: [
      {
        id: 7,
        nombre: 'Vestido Gala Aurora',
        tipo_prenda: 'vestido',
        precio_base: 380,
        imagen_url: '/assets/vestido.jpg',
        ar_overlay_url: '/assets/vestido-ar.png',
        variante: {
          talla: 'S', color: 'rojo', unidades_disponibles: 4, precio_adicional: 0,
        },
      },
      {
        id: 8,
        nombre: 'Vestido Noche',
        tipo_prenda: 'vestido',
        precio_base: 420,
        imagen_url: '/assets/noche.jpg',
        ar_overlay_url: '/assets/noche-ar.png',
        variante: {
          talla: 'M', color: 'negro', unidades_disponibles: 0, precio_adicional: 15,
        },
      },
    ],
  },
  consulta: {
    filtros_catalogo: { tipo_prenda: 'vestido', color: 'negro', talla: 'S', terminos: [], sucursal_id: null },
    resumen_filtrado: {
      productos: 1,
      variantes: 1,
      unidades_fisicas: 4,
      unidades_reservadas: 1,
      unidades_disponibles: 3,
    },
  },
  sucursales: [],
  promociones_activas: [],
  promociones_total: 0,
  analitica_comercial: null,
};

console.log('=== IA context: respuestas verificables y permisos ===');
const totalReply = buildAssistantLocalReply('¿Cuántas prendas hay?', {
  ...context,
  consulta: { filtros_catalogo: { tipo_prenda: null, color: null, talla: null, terminos: [] }, resumen_filtrado: context.catalogo.resumen_total },
});
assert.match(totalReply, /8 productos/);
assert.match(totalReply, /24 variantes\/SKU/);
assert.match(totalReply, /236 unidades disponibles/);

const filteredReply = buildAssistantLocalReply('¿Cuántos vestidos negros talla S hay?', context);
assert.match(filteredReply, /1 productos/);
assert.match(filteredReply, /3 unidades disponibles/);

const guestSalesReply = buildAssistantLocalReply('¿Cuántas ventas hubo?', context);
assert.match(guestSalesReply, /requieren iniciar sesión/);
assert.doesNotMatch(guestSalesReply, /Bs\.\s*0/);
const guestReturnsReply = buildAssistantLocalReply('¿Cuántas devoluciones hubo?', context);
assert.match(guestReturnsReply, /requieren iniciar sesión/);

const adminContext = {
  ...context,
  acceso: { rol: 'admin', puede_consultar_metricas_comerciales: true },
  analitica_comercial: {
    clientes_activos: 12,
    reservas: { reservas_activas: 2, citas_futuras: 1 },
    ventas: { ventas_confirmadas: 4, ingresos_confirmados_bs: 920, ventas_pendientes_pago: 1 },
  },
  datos_operativos: {
    usuarios: { activos: 15, activos_por_rol: { admin: 1, encargado: 1, cajero: 2, cliente: 11 } },
    devoluciones: { total: 3, por_estado: { reembolsada: 2, procesada: 1 }, monto_reembolsado_bs: 510 },
    pagos: { total: 9, por_estado: { aprobado: 6, pendiente: 2, rechazado: 1 }, monto_confirmado_bs: 920 },
    recepciones: { total: 2, por_estado: { completada: 1, en_transito: 1 }, costo_total_bs: 3075 },
    cajas: { total: 2, por_estado: { abierta: 1, cerrada: 1 } },
    proveedores: { total: 3, activos: 2 },
    operaciones_offline: { total: 2, por_estado: { sincronizada: 1, pendiente: 1 } },
    inventario: { movimientos_total: 5, movimientos_ultimos_30_dias: 4, movimientos_por_tipo: { recepcion: 2, venta: 1, reserva: 1, devolucion: 1 }, posiciones_stock_critico: 2, stock_critico_por_sucursal: [{ sucursal: 'Central', posiciones: 3 }] },
    cuentas_por_cobrar: { total: 1, por_estado: { PARCIAL: 1 }, saldo_pendiente_bs: 95, saldo_vencido_bs: 0, abonos_total: 4, abonos_monto_bs: 120, abonos_por_metodo: { efectivo: 3, qr: 1 } },
    propuestas_producto: { total: 2, por_estado: { pendiente: 1, aprobada: 1 } },
    suscripciones: { total: 1, por_estado: { activa: 1 }, solicitudes_por_estado: { pendiente_aprobacion: 1, aprobada_sandbox: 1 } },
    notificaciones_no_leidas: 3,
    reportes_generados: 2,
    interacciones: { total: 6, por_tipo: { probador_ar: 1 } },
    recomendaciones_ia: 2,
    modelos_ml: { total: 3, por_estado: { APROBADO: 3 } },
    predicciones_ml: { total: 3, sinteticas: 3 },
  },
};
assert.match(buildAssistantLocalReply('¿Cuántas devoluciones hubo?', adminContext), /3 devoluciones/);
assert.match(buildAssistantLocalReply('¿Cuántos pagos están pendientes?', adminContext), /pendiente: 2/);
assert.match(buildAssistantLocalReply('¿Cuántas recepciones están en tránsito?', adminContext), /Bs\. 3075\.00/);
assert.match(buildAssistantLocalReply('¿Cuántas operaciones offline siguen pendientes?', adminContext), /pendiente: 1/);
assert.match(buildAssistantLocalReply('¿Cuánto saldo vencido tenemos?', adminContext), /saldo vencido: Bs\. 0\.00/);
const installments = buildAssistantLocalReply('¿Cuántos abonos se registraron?', adminContext);
assert.match(installments, /4 abonos por Bs\. 120\.00/);
assert.match(installments, /efectivo: 3, qr: 1/);
const branchStockContext = {
  ...adminContext,
  consulta: { ...context.consulta, filtros_catalogo: { ...context.consulta.filtros_catalogo, sucursal_nombre: 'Central' } },
};
assert.match(buildAssistantLocalReply('¿Cuántas posiciones de stock crítico hay en sucursal Central?', branchStockContext), /Central tiene 3 posiciones/);
assert.match(buildAssistantLocalReply('¿Cuántas categorías hay?', adminContext), /4 categorías activas/);
assert.match(buildAssistantLocalReply('¿Cuántos clientes tenemos?', adminContext), /12 clientes activos/);
assert.match(buildAssistantLocalReply('¿Cuántos empleados hay?', adminContext), /15 usuarios activos/);

const unavailableReply = buildAssistantLocalReply('¿Cuántos vestidos hay?', {
  base_datos_disponible: false,
  catalogo: { productos_relevantes: [{ nombre: 'Producto ficticio' }] },
});
assert.match(unavailableReply, /no voy a inventar/);
assert.doesNotMatch(unavailableReply, /Producto ficticio/);

const suggestions = assistantSuggestedProducts(context);
assert.equal(suggestions.length, 1);
assert.equal(suggestions[0].nombre, 'Vestido Gala Aurora');
assert.deepEqual(assistantContextSources(context), ['catálogo, categorías y colecciones', 'inventario', 'sucursales', 'promociones', 'planes SaaS']);

console.log('OK: pruebas de contexto y fallback de IA superadas.');
