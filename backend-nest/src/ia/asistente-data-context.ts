import { PoolClient } from 'pg';

export interface AssistantIdentityScope {
  userId: number | null;
  branchId: number | null;
  providerId: number | null;
}

export interface AssistantBusinessDetails {
  fuentes_disponibles: string[];
  fuentes_consultadas: string[];
  registros: Record<string, {
    total: number;
    incluidos: number;
    limite: number;
    truncado: boolean;
    filas: Array<Record<string, any>>;
  }>;
}

const DETAIL_LIMIT = 100;

const PUBLIC_SOURCES = [
  'catálogo y variantes disponibles',
  'inventario disponible al público',
  'sucursales, horarios y promociones activas',
  'planes de suscripción publicados',
];

const ROLE_SOURCES: Record<string, string[]> = {
  admin: [
    'ventas, pedidos e ítems', 'reservas y citas', 'pagos y devoluciones',
    'recepciones y proveedores', 'cajas POS', 'inventario y movimientos',
    'cuentas por cobrar y abonos', 'propuestas de producto', 'suscripciones',
    'operaciones offline y sincronización', 'webhooks y sagas de pago (sin payloads)',
    'auditoría (sin IP ni contenido)', 'modelos ML y metadatos de predicciones',
    'reportes generados (sin resultados ni solicitudes)', 'notificaciones propias/globales',
    'actividad IA en forma agregada (sin conversaciones)', 'usuarios solo en agregado, sin PII',
  ],
  encargado: [
    'ventas, pedidos e ítems', 'reservas y citas', 'pagos y devoluciones',
    'recepciones y proveedores', 'cajas POS', 'inventario y movimientos',
    'cuentas por cobrar y abonos', 'propuestas de producto', 'suscripciones',
    'operaciones offline y sincronización', 'webhooks y sagas de pago (sin payloads)',
    'auditoría (sin IP ni contenido)', 'modelos ML y metadatos de predicciones',
    'reportes generados (sin resultados ni solicitudes)', 'notificaciones propias/globales',
    'actividad IA en forma agregada (sin conversaciones)',
  ],
  cajero: [
    'ventas, pedidos e ítems', 'reservas y citas', 'pagos vinculados a ventas visibles',
    'cajas POS', 'inventario disponible', 'notificaciones propias/globales',
    'operaciones offline propias',
  ],
  cliente: [
    'ventas, pedidos e ítems propios', 'reservas y citas propias',
    'pagos vinculados a ventas propias', 'notificaciones propias',
  ],
  proveedor: [
    'propuestas de producto propias', 'notificaciones propias',
  ],
};

const DATASET_RULES: Array<{ key: string; pattern: RegExp; roles: string[] }> = [
  { key: 'ventas', pattern: /\b(ventas?|pedidos?|ordenes?|comprobantes?)\b/, roles: ['admin', 'encargado', 'cajero', 'cliente'] },
  { key: 'reservas', pattern: /\b(reservas?|citas?|apartados?)\b/, roles: ['admin', 'encargado', 'cajero', 'cliente'] },
  { key: 'pagos', pattern: /\b(pagos?|transacciones?|qr|stripe|libelula|transferencias?)\b/, roles: ['admin', 'encargado', 'cajero', 'cliente'] },
  { key: 'devoluciones', pattern: /\b(devoluciones?|reembolsos?)\b/, roles: ['admin', 'encargado'] },
  { key: 'recepciones', pattern: /\b(recepciones?|compras?)\b/, roles: ['admin', 'encargado'] },
  { key: 'cajas', pattern: /\b(cajas?|turnos?|cierres?(?:\s+de\s+caja)?)\b/, roles: ['admin', 'encargado', 'cajero'] },
  { key: 'inventario', pattern: /\b(stock|inventario|almacenes?)\b/, roles: ['admin', 'encargado', 'cajero'] },
  { key: 'movimientos_inventario', pattern: /\b(movimientos?(?:\s+de\s+inventario)?|ajustes?)\b/, roles: ['admin', 'encargado'] },
  { key: 'proveedores', pattern: /\b(proveedores?)\b/, roles: ['admin', 'encargado'] },
  { key: 'propuestas_producto', pattern: /\b(propuestas?(?:\s+de\s+producto)?)\b/, roles: ['admin', 'encargado', 'proveedor'] },
  { key: 'cuentas_por_cobrar', pattern: /\b(cuentas?\s+por\s+cobrar|deudas?|saldos?)\b/, roles: ['admin', 'encargado'] },
  { key: 'abonos', pattern: /\b(abonos?)\b/, roles: ['admin', 'encargado'] },
  { key: 'suscripciones', pattern: /\b(suscripciones?|plan\s+actual|solicitudes?\s+de\s+plan)\b/, roles: ['admin', 'encargado'] },
  { key: 'sincronizacion', pattern: /\b(operaciones?\s+offline|sincronizaciones?|conflictos?|dispositivos?|feed)\b/, roles: ['admin', 'encargado', 'cajero'] },
  { key: 'webhooks', pattern: /\b(webhooks?)\b/, roles: ['admin', 'encargado'] },
  { key: 'sagas_pago', pattern: /\b(sagas?\s+de\s+pago|conciliacion|conciliar)\b/, roles: ['admin', 'encargado'] },
  { key: 'auditoria', pattern: /\b(auditoria|aprovisionamiento)\b/, roles: ['admin', 'encargado'] },
  { key: 'modelos_ml', pattern: /\b(modelos?(?:\s+ml)?|entrenamiento)\b/, roles: ['admin', 'encargado'] },
  { key: 'predicciones_ml', pattern: /\b(predicciones?|pronosticos?)\b/, roles: ['admin', 'encargado'] },
  { key: 'segmentos_cliente', pattern: /\b(segmentos?(?:\s+de\s+clientes?)?|clusters?)\b/, roles: ['admin', 'encargado'] },
  { key: 'reportes', pattern: /\b(reportes?|informes?)\b/, roles: ['admin', 'encargado'] },
  { key: 'notificaciones', pattern: /\b(notificaciones?)\b/, roles: ['admin', 'encargado', 'cajero', 'cliente', 'proveedor'] },
  { key: 'actividad_ia', pattern: /\b(interacciones?|recomendaciones?\s+ia|conversaciones?(?:\s+ia)?)\b/, roles: ['admin', 'encargado'] },
  { key: 'usuarios_agregado', pattern: /\b(usuarios?|clientes?|personal|empleados?)\b/, roles: ['admin', 'encargado'] },
];

const SECRET_PROPERTY = /(?:password|passwd|secret|api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|credential|connection[_-]?string|database[_-]?url|private[_-]?key|payload(?:_provider|_json)?|hash_request|payload_hash|device_key|metadata_json|perfil_json|valor_json|resultado_json|respuesta_json|solicitud|detalle_json|ip)$/i;
const SECRET_VALUE_PATTERNS = [
  /\b(?:api[_ -]?key|secret|password|passwd|contrase(?:n|ñ)a|clave interna|authorization|bearer token)\b\s*[:=]\s*[^\s,;]+/gi,
  /\b(?:sk_live_|sk_test_|rk_live_|rk_test_|whsec_|gsk_|ghp_|github_pat_)[a-z0-9_-]{8,}\b/gi,
  /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi,
];

/**
 * defense-in-depth for values that can originate from free-form business text.
 * The context itself is built from explicit read-only projections; this pass strips
 * secret-shaped keys and recognizable credentials before sending anything to an LLM.
 */
export function sanitizeAssistantContext<T>(value: T): T {
  if (typeof value === 'string') {
    let clean: string = String(value);
    for (const pattern of SECRET_VALUE_PATTERNS) clean = clean.replace(pattern, '[REDACTADO]');
    return clean as unknown as T;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeAssistantContext(item)) as T;
  if (!value || typeof value !== 'object') return value;
  const safeEntries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SECRET_PROPERTY.test(key))
    .map(([key, item]) => [key, sanitizeAssistantContext(item)] as const);
  return Object.fromEntries(safeEntries) as T;
}

export function assistantAvailableBusinessSources(role: string | null): string[] {
  const normalizedRole = String(role || '').toLowerCase();
  return [...PUBLIC_SOURCES, ...(ROLE_SOURCES[normalizedRole] || [])];
}

export function selectAssistantDetailDatasets(question: string, role: string | null): string[] {
  const normalizedRole = String(role || '').toLowerCase();
  if (!normalizedRole) return [];
  const q = String(question || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const listIntent = /\b(lista|listar|muestra|muestr\w*|mostrar|detalle|detalles|registros?|ultim\w*|recient\w*|cuales|dame|dime|ver|mis?\s+(?:ventas?|pedidos?|reservas?|pagos?))\b/.test(q);
  const asksForNamedData = /\b(informacion|datos?)\b.*\b(de|del|sobre)\b/.test(q);
  const specificStatus = /\b(estado|estatus)\b/.test(q) && /(?:#\s*\d+|\b(?:id|numero|nro)\s*\d+\b)/.test(q);
  const asksCount = /\b(cuant\w*|cuanto|cuanta|conteo|cantidad(?:es)?|total(?:es)?|resumen|metricas?)\b/.test(q);
  if ((!listIntent && !asksForNamedData && !specificStatus) || (asksCount && !listIntent)) return [];
  return DATASET_RULES
    .filter((rule) => rule.roles.includes(normalizedRole) && rule.pattern.test(q))
    .map((rule) => rule.key)
    .slice(0, 6);
}

function resultEnvelope(rows: Array<Record<string, any>>) {
  const total = rows.length ? Number(rows[0].total_registros ?? rows.length) : 0;
  const safeRows = rows.map(({ total_registros: _total, ...row }) => sanitizeAssistantContext(row));
  return {
    total: Number.isFinite(total) ? total : safeRows.length,
    incluidos: safeRows.length,
    limite: DETAIL_LIMIT,
    truncado: total > safeRows.length,
    filas: safeRows,
  };
}

async function queryRows(client: PoolClient, sql: string, params: unknown[]) {
  const result = await client.query(sql, params as any[]);
  return resultEnvelope(result.rows as Array<Record<string, any>>);
}

export async function loadAssistantBusinessDetails(
  client: PoolClient,
  tenantId: string,
  question: string,
  role: string | null,
  identity: AssistantIdentityScope = { userId: null, branchId: null, providerId: null },
): Promise<AssistantBusinessDetails> {
  const fuentesDisponibles = assistantAvailableBusinessSources(role);
  const roleKey = String(role || '').toLowerCase();
  const registros: AssistantBusinessDetails['registros'] = {};
  const isPrivilegedStaff = roleKey === 'admin' || roleKey === 'encargado';
  const userId = Number.isSafeInteger(identity.userId) && Number(identity.userId) > 0 ? Number(identity.userId) : null;
  const providerId = Number.isSafeInteger(identity.providerId) && Number(identity.providerId) > 0 ? Number(identity.providerId) : null;
  // Never turn a missing identity into an unfiltered query for a customer or supplier.
  const requested = selectAssistantDetailDatasets(question, roleKey).filter((key) => {
    if (roleKey === 'cliente' && ['ventas', 'reservas', 'pagos', 'notificaciones'].includes(key)) return userId !== null;
    if (roleKey === 'proveedor' && key === 'propuestas_producto') return providerId !== null;
    return true;
  });
  const userFilter = roleKey === 'cliente' ? userId : null;

  if (requested.includes('ventas')) {
    registros.ventas = await queryRows(client, `
      WITH detalle AS (
        SELECT v.id, v.numero_comprobante, v.origen, v.estado, v.estado_pago,
               v.metodo_pago, v.subtotal::float8 AS subtotal_bs,
               v.descuento::float8 AS descuento_bs, v.total::float8 AS total_bs,
               v.es_credito, v.credito_vencimiento, v.promocion_codigo,
               v.creado_en, v.actualizado_en, s.nombre AS sucursal,
               COALESCE(
                 jsonb_agg(jsonb_build_object(
                   'producto', p.nombre, 'sku', vr.sku, 'talla', vr.talla, 'color', vr.color,
                   'cantidad', vi.cantidad, 'precio_unitario_bs', vi.precio_unitario,
                   'descuento_unitario_bs', vi.descuento_unitario, 'subtotal_bs', vi.subtotal
                 ) ORDER BY vi.id) FILTER (WHERE vi.id IS NOT NULL), '[]'::jsonb
               ) AS items
          FROM public.ventas v
          JOIN public.sucursales s ON s.tenant_id = v.tenant_id AND s.id = v.sucursal_id
          LEFT JOIN public.venta_items vi ON vi.tenant_id = v.tenant_id AND vi.venta_id = v.id
          LEFT JOIN public.variantes vr ON vr.tenant_id = vi.tenant_id AND vr.id = vi.variante_id
          LEFT JOIN public.productos p ON p.tenant_id = vr.tenant_id AND p.id = vr.producto_id
         WHERE v.tenant_id = $1 AND ($2::int IS NULL OR v.usuario_id = $2)
         GROUP BY v.id, s.nombre
      )
      SELECT detalle.*, COUNT(*) OVER()::int AS total_registros
        FROM detalle
       ORDER BY creado_en DESC, id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId, userFilter]);
  }

  if (requested.includes('reservas')) {
    registros.reservas = await queryRows(client, `
      WITH detalle AS (
        SELECT r.id, r.codigo, r.estado, r.fecha_cita, r.expira_en, r.creado_en,
               r.actualizado_en, s.nombre AS sucursal,
               COALESCE(
                 jsonb_agg(jsonb_build_object(
                   'producto', p.nombre, 'sku', vr.sku, 'talla', vr.talla, 'color', vr.color,
                   'cantidad', dr.cantidad, 'precio_unitario_bs', dr.precio_unitario
                 ) ORDER BY dr.id) FILTER (WHERE dr.id IS NOT NULL), '[]'::jsonb
               ) AS items
          FROM public.reservas r
          JOIN public.sucursales s ON s.tenant_id = r.tenant_id AND s.id = r.sucursal_id
          LEFT JOIN public.detalle_reserva dr ON dr.tenant_id = r.tenant_id AND dr.reserva_id = r.id
          LEFT JOIN public.variantes vr ON vr.tenant_id = dr.tenant_id AND vr.id = dr.variante_id
          LEFT JOIN public.productos p ON p.tenant_id = vr.tenant_id AND p.id = vr.producto_id
         WHERE r.tenant_id = $1 AND ($2::int IS NULL OR r.usuario_id = $2)
         GROUP BY r.id, s.nombre
      )
      SELECT detalle.*, COUNT(*) OVER()::int AS total_registros
        FROM detalle
       ORDER BY creado_en DESC, id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId, userFilter]);
  }

  if (requested.includes('pagos')) {
    registros.pagos = await queryRows(client, `
      SELECT pg.id, pg.venta_id, v.numero_comprobante, pg.pasarela, pg.metodo,
             pg.monto::float8 AS monto_bs, pg.moneda, pg.modo, pg.estado,
             pg.confirmado_proveedor, pg.expira_en, pg.confirmado_en, pg.creado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.pagos pg
        JOIN public.ventas v ON v.tenant_id = pg.tenant_id AND v.id = pg.venta_id
       WHERE pg.tenant_id = $1 AND ($2::int IS NULL OR v.usuario_id = $2)
       ORDER BY pg.creado_en DESC, pg.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId, userFilter]);
  }

  if (requested.includes('devoluciones')) {
    registros.devoluciones = await queryRows(client, `
      SELECT d.id, d.venta_id, v.numero_comprobante, d.estado,
             d.monto_reembolsado::float8 AS monto_reembolsado_bs, d.creado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.devoluciones d
        JOIN public.ventas v ON v.tenant_id = d.tenant_id AND v.id = d.venta_id
       WHERE d.tenant_id = $1
       ORDER BY d.creado_en DESC, d.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('recepciones')) {
    registros.recepciones = await queryRows(client, `
      WITH detalle AS (
        SELECT r.id, r.numero_documento, r.estado, r.total_costo::float8 AS total_costo_bs,
               r.creado_en, a.nombre AS almacen, s.nombre AS sucursal, pv.razon_social AS proveedor,
               COALESCE(
                 jsonb_agg(jsonb_build_object(
                   'producto', p.nombre, 'sku', vr.sku, 'talla', vr.talla, 'color', vr.color,
                   'cantidad', ri.cantidad, 'costo_unitario_bs', ri.costo_unitario
                 ) ORDER BY ri.id) FILTER (WHERE ri.id IS NOT NULL), '[]'::jsonb
               ) AS items
          FROM public.recepciones r
          JOIN public.almacenes a ON a.tenant_id = r.tenant_id AND a.id = r.almacen_id
          JOIN public.sucursales s ON s.tenant_id = a.tenant_id AND s.id = a.sucursal_id
          LEFT JOIN public.proveedores pv ON pv.tenant_id = r.tenant_id AND pv.id = r.proveedor_id
          LEFT JOIN public.recepcion_items ri ON ri.tenant_id = r.tenant_id AND ri.recepcion_id = r.id
          LEFT JOIN public.variantes vr ON vr.tenant_id = ri.tenant_id AND vr.id = ri.variante_id
          LEFT JOIN public.productos p ON p.tenant_id = vr.tenant_id AND p.id = vr.producto_id
         WHERE r.tenant_id = $1
         GROUP BY r.id, a.nombre, s.nombre, pv.razon_social
      )
      SELECT detalle.*, COUNT(*) OVER()::int AS total_registros
        FROM detalle
       ORDER BY creado_en DESC, id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('cajas')) {
    registros.cajas = await queryRows(client, `
      SELECT c.id, c.estado, c.monto_inicial::float8 AS monto_inicial_bs,
             c.monto_ventas_efectivo::float8 AS ventas_efectivo_bs,
             c.monto_ventas_digital::float8 AS ventas_digitales_bs,
             c.monto_cierre_declarado::float8 AS monto_cierre_declarado_bs,
             c.diferencia_arqueo::float8 AS diferencia_arqueo_bs,
             c.abierta_en, c.cerrada_en, s.nombre AS sucursal,
             COUNT(*) OVER()::int AS total_registros
        FROM public.cajas c
        JOIN public.sucursales s ON s.tenant_id = c.tenant_id AND s.id = c.sucursal_id
       WHERE c.tenant_id = $1
       ORDER BY c.abierta_en DESC, c.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('inventario')) {
    registros.inventario = await queryRows(client, `
      SELECT st.id, st.cantidad AS unidades_fisicas, st.reservado AS unidades_reservadas,
             (st.cantidad - st.reservado)::int AS unidades_disponibles,
             st.stock_minimo, st.ubicacion, st.actualizado_en,
             a.nombre AS almacen, s.nombre AS sucursal,
             p.nombre AS producto, p.codigo AS codigo_producto,
             p.tipo_prenda, vr.sku, vr.talla, vr.color,
             COUNT(*) OVER()::int AS total_registros
        FROM public.stock st
        JOIN public.almacenes a ON a.tenant_id = st.tenant_id AND a.id = st.almacen_id
        JOIN public.sucursales s ON s.tenant_id = a.tenant_id AND s.id = a.sucursal_id
        JOIN public.variantes vr ON vr.tenant_id = st.tenant_id AND vr.id = st.variante_id
        JOIN public.productos p ON p.tenant_id = vr.tenant_id AND p.id = vr.producto_id
       WHERE st.tenant_id = $1 AND p.activo = TRUE AND vr.activa = TRUE
       ORDER BY s.nombre, p.nombre, vr.sku
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('movimientos_inventario')) {
    registros.movimientos_inventario = await queryRows(client, `
      SELECT m.id, m.tipo, m.cantidad, m.saldo_cantidad, m.saldo_reservado, m.creado_en,
             a.nombre AS almacen, s.nombre AS sucursal,
             p.nombre AS producto, vr.sku, vr.talla, vr.color,
             COUNT(*) OVER()::int AS total_registros
        FROM public.movimientos_inventario m
        JOIN public.almacenes a ON a.tenant_id = m.tenant_id AND a.id = m.almacen_id
        JOIN public.sucursales s ON s.tenant_id = a.tenant_id AND s.id = a.sucursal_id
        JOIN public.variantes vr ON vr.tenant_id = m.tenant_id AND vr.id = m.variante_id
        JOIN public.productos p ON p.tenant_id = vr.tenant_id AND p.id = vr.producto_id
       WHERE m.tenant_id = $1
       ORDER BY m.creado_en DESC, m.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('proveedores')) {
    registros.proveedores = await queryRows(client, `
      SELECT pv.id, pv.razon_social, pv.activo, pv.creado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.proveedores pv
       WHERE pv.tenant_id = $1
       ORDER BY pv.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('propuestas_producto')) {
    registros.propuestas_producto = await queryRows(client, `
      SELECT pr.id, pr.nombre, pr.tipo_prenda, pr.color, pr.tallas_sugeridas,
             pr.costo_propuesto::float8 AS costo_propuesto_bs,
             pr.precio_sugerido::float8 AS precio_sugerido_bs,
             pr.cantidad_disponible, LEFT(COALESCE(pr.descripcion, ''), 500) AS descripcion,
             pr.estado, pr.creado_en, pv.razon_social AS proveedor,
             COUNT(*) OVER()::int AS total_registros
        FROM public.propuestas_producto pr
        JOIN public.proveedores pv ON pv.tenant_id = pr.tenant_id AND pv.id = pr.proveedor_id
       WHERE pr.tenant_id = $1 AND ($2::int IS NULL OR pr.proveedor_id = $2)
       ORDER BY pr.creado_en DESC, pr.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId, roleKey === 'proveedor' ? providerId : null]);
  }

  if (requested.includes('cuentas_por_cobrar')) {
    registros.cuentas_por_cobrar = await queryRows(client, `
      SELECT c.id, c.venta_id, v.numero_comprobante,
             c.monto_original::float8 AS monto_original_bs,
             c.monto_abonado::float8 AS monto_abonado_bs, c.saldo::float8 AS saldo_bs,
             c.estado, c.vence_en, c.creado_en, c.actualizado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.cuentas_por_cobrar c
        JOIN public.ventas v ON v.tenant_id = c.tenant_id AND v.id = c.venta_id
       WHERE c.tenant_id = $1
       ORDER BY c.creado_en DESC, c.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('abonos')) {
    registros.abonos = await queryRows(client, `
      SELECT a.id, a.cuenta_id, a.monto::float8 AS monto_bs, a.metodo_pago, a.creado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.abonos_cuenta a
       WHERE a.tenant_id = $1
       ORDER BY a.creado_en DESC, a.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('suscripciones')) {
    const subscriptionRows = await queryRows(client, `
      SELECT s.plan_codigo, p.nombre AS plan_nombre, s.estado, s.inicio, s.vence_en,
             s.modo_cobro, s.creado_en, s.actualizado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.suscripciones s
        JOIN public.planes_suscripcion p ON p.codigo = s.plan_codigo
       WHERE s.tenant_id = $1
       ORDER BY s.actualizado_en DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
    const requestRows = await queryRows(client, `
      SELECT r.id, r.plan_actual, r.plan_solicitado, r.estado, r.cobro_real, r.creado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.solicitudes_suscripcion r
       WHERE r.tenant_id = $1
       ORDER BY r.creado_en DESC, r.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
    registros.suscripciones = {
      total: subscriptionRows.total + requestRows.total,
      incluidos: subscriptionRows.incluidos + requestRows.incluidos,
      limite: DETAIL_LIMIT,
      truncado: subscriptionRows.truncado || requestRows.truncado,
      filas: [
        ...subscriptionRows.filas.map((row) => ({ tipo_registro: 'suscripcion', ...row })),
        ...requestRows.filas.map((row) => ({ tipo_registro: 'solicitud', ...row })),
      ],
    };
  }

  if (requested.includes('sincronizacion')) {
    const allTenantOps = isPrivilegedStaff;
    registros.sincronizacion = await queryRows(client, `
      SELECT o.id AS operacion, o.tipo, o.estado, o.creado_en, o.procesado_en,
             c.estado AS conflicto_estado, c.tipo AS conflicto_tipo,
             c.regla AS regla_resolucion, c.resolucion, c.resuelto_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.operaciones_offline o
        LEFT JOIN public.conflictos_sync c
          ON c.tenant_id = o.tenant_id AND c.operacion_id = o.id
       WHERE o.tenant_id = $1 AND ($2::boolean = TRUE OR o.usuario_id = $3)
       ORDER BY o.creado_en DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId, allTenantOps, userId]);
  }

  if (requested.includes('webhooks')) {
    registros.webhooks = await queryRows(client, `
      SELECT w.provider, w.monto::float8 AS monto_bs, w.firma_valida, w.procesado,
             w.intentos, w.recibido_en, w.procesado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.webhooks_recibidos w
       WHERE w.tenant_id = $1
       ORDER BY w.recibido_en DESC, w.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('sagas_pago')) {
    registros.sagas_pago = await queryRows(client, `
      SELECT s.estado, s.paso_actual, s.intentos, s.creado_en, s.actualizado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.saga_pago s
       WHERE s.tenant_id = $1
       ORDER BY s.actualizado_en DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('auditoria')) {
    registros.auditoria = await queryRows(client, `
      SELECT a.entidad, a.accion, a.creado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.auditoria a
       WHERE a.tenant_id = $1
       ORDER BY a.creado_en DESC, a.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('modelos_ml')) {
    registros.modelos_ml = await queryRows(client, `
      SELECT m.algoritmo, m.version, m.estado, m.semilla, m.metricas, m.features_json, m.creado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.modelos_ml m
       WHERE m.tenant_id = $1
       ORDER BY m.creado_en DESC, m.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('predicciones_ml')) {
    registros.predicciones_ml = await queryRows(client, `
      SELECT p.entidad_tipo, p.es_sintetico, p.creado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.predicciones p
       WHERE p.tenant_id = $1
       ORDER BY p.creado_en DESC, p.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('segmentos_cliente')) {
    registros.segmentos_cliente = await queryRows(client, `
      SELECT s.cluster_id, s.es_sintetico, s.creado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.segmentos_cliente s
       WHERE s.tenant_id = $1
       ORDER BY s.creado_en DESC, s.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('reportes')) {
    registros.reportes = await queryRows(client, `
      SELECT r.motor, r.creado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.reportes_generados r
       WHERE r.tenant_id = $1
       ORDER BY r.creado_en DESC, r.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
  }

  if (requested.includes('notificaciones') && userId !== null) {
    const staffCanReadGlobal = ['admin', 'encargado', 'cajero'].includes(roleKey);
    registros.notificaciones = await queryRows(client, `
      SELECT n.titulo, n.tipo, n.leida, n.creado_en,
             COUNT(*) OVER()::int AS total_registros
        FROM public.notificaciones n
       WHERE n.tenant_id = $1
         AND (n.usuario_id = $2 OR ($3::boolean = TRUE AND n.usuario_id IS NULL))
       ORDER BY n.creado_en DESC, n.id DESC
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId, userId, staffCanReadGlobal]);
  }

  if (requested.includes('actividad_ia')) {
    const [interactions, recommendations, conversations] = await Promise.all([
      queryRows(client, `
        SELECT i.tipo, i.creado_en, COUNT(*) OVER()::int AS total_registros
          FROM public.interacciones i
         WHERE i.tenant_id = $1
         ORDER BY i.creado_en DESC, i.id DESC
         LIMIT ${DETAIL_LIMIT}
      `, [tenantId]),
      queryRows(client, `
        SELECT r.algoritmo, r.creado_en, COUNT(*) OVER()::int AS total_registros
          FROM public.recomendaciones_ia r
         WHERE r.tenant_id = $1
         ORDER BY r.creado_en DESC, r.id DESC
         LIMIT ${DETAIL_LIMIT}
      `, [tenantId]),
      queryRows(client, `
        SELECT c.intencion, c.proveedor_llm, c.creado_en,
               COUNT(*) OVER()::int AS total_registros
          FROM public.conversaciones_ia c
         WHERE c.tenant_id = $1
         ORDER BY c.creado_en DESC, c.id DESC
         LIMIT ${DETAIL_LIMIT}
      `, [tenantId]),
    ]);
    registros.actividad_ia = {
      total: interactions.total + recommendations.total + conversations.total,
      incluidos: interactions.incluidos + recommendations.incluidos + conversations.incluidos,
      limite: DETAIL_LIMIT,
      truncado: interactions.truncado || recommendations.truncado || conversations.truncado,
      filas: [
        ...interactions.filas.map((row) => ({ tipo_registro: 'interaccion', ...row })),
        ...recommendations.filas.map((row) => ({ tipo_registro: 'recomendacion', ...row })),
        ...conversations.filas.map((row) => ({ tipo_registro: 'conversacion_solo_metadatos', ...row })),
      ],
    };
  }

  if (requested.includes('usuarios_agregado')) {
    const users = await queryRows(client, `
      SELECT u.rol, u.activo, COUNT(*) OVER()::int AS total_registros
        FROM public.usuarios u
       WHERE u.tenant_id = $1
       ORDER BY u.rol, u.activo
       LIMIT ${DETAIL_LIMIT}
    `, [tenantId]);
    registros.usuarios_agregado = {
      ...users,
      filas: users.filas.map((row) => ({ rol: row.rol, activo: row.activo })),
    };
  }

  return sanitizeAssistantContext({
    fuentes_disponibles: fuentesDisponibles,
    fuentes_consultadas: Object.keys(registros),
    registros,
  });
}
