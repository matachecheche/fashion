import { PoolClient } from 'pg';
import { TenantInfo } from '../common/tenant-context';
import { AssistantIdentityScope, loadAssistantBusinessDetails, sanitizeAssistantContext } from './asistente-data-context';

export interface AssistantFilters {
  tipo_prenda: string | null;
  color: string | null;
  talla: string | null;
  terminos: string[];
}

const TIPOS: Array<{ value: string; aliases: string[] }> = [
  { value: 'blusa', aliases: ['blusa', 'blusas'] },
  { value: 'camiseta', aliases: ['camiseta', 'camisetas', 'remera', 'remeras', 'polera', 'poleras', 'camisa', 'camisas'] },
  { value: 'cartera', aliases: ['cartera', 'carteras', 'bolso', 'bolsos'] },
  { value: 'chaqueta', aliases: ['chaqueta', 'chaquetas', 'saco', 'sacos', 'chamarra', 'chamarras'] },
  { value: 'falda', aliases: ['falda', 'faldas'] },
  { value: 'pantalon', aliases: ['pantalon', 'pantalones', 'jean', 'jeans'] },
  { value: 'vestido', aliases: ['vestido', 'vestidos'] },
  { value: 'zapato', aliases: ['zapato', 'zapatos', 'calzado', 'zapatilla', 'zapatillas'] },
];

const COLORES: Array<{ value: string; aliases: string[] }> = [
  { value: 'rojo', aliases: ['rojo', 'roja', 'rojos', 'rojas'] },
  { value: 'negro', aliases: ['negro', 'negra', 'negros', 'negras'] },
  { value: 'blanco', aliases: ['blanco', 'blanca', 'blancos', 'blancas'] },
  { value: 'azul', aliases: ['azul', 'azules'] },
  { value: 'verde', aliases: ['verde', 'verdes'] },
  { value: 'beige', aliases: ['beige'] },
  { value: 'camel', aliases: ['camel'] },
  { value: 'vino', aliases: ['vino', 'bordo', 'borgona'] },
  { value: 'gris', aliases: ['gris', 'grises'] },
  { value: 'rosado', aliases: ['rosado', 'rosada', 'rosa', 'rosas'] },
  { value: 'mostaza', aliases: ['mostaza'] },
  { value: 'celeste', aliases: ['celeste'] },
  { value: 'morado', aliases: ['morado', 'morada', 'lila', 'violeta'] },
  { value: 'marron', aliases: ['marron', 'marrones', 'cafe', 'chocolate'] },
  { value: 'naranja', aliases: ['naranja', 'anaranjado', 'anaranjada'] },
];

const STOP_WORDS = new Set(
  'a al algo algun alguna algunos algunas ante aqui asi aun aunque ayer bajo bastante bien cada casi como con contra cual cuales cuando cuanto cuanta cuantos cuantas cuenta cantidad cantidades conteo numero numeros total totales de del desde donde dos el ella ellas ellos en entre era es esa esas ese eso esos esta estas este esto estos fue ha hay hacia hasta la las le les lo los mas me mi mis mucha muchas mucho muchos muy nada ni no nos o os otra otras otro otros para pero poca pocas poco pocos por porque que quien quienes se sea segun ser si sin sobre su sus tal tambien te tener tengo tienes tenemos tiene tienen todo todos tras tu tus un una unas uno unos va vamos y yo quiero quisieras quisiera necesito necesito mostrar muestra buscar busco busca dime indica cuentame tienda tiendas ropa prenda prendas producto productos articulo articulos catalogo inventario stock disponible disponibles fisico fisica reservada reservadas reservado reservados unidades unidad precio precios talla talle tamano size sucursal sucursales local locales rama barata barato baratos baratas menor mayor economico economica economicos economicas mas vendido vendidos vendida vendidas venta ventas ingreso ingresos recaudado recaudo mes mensual meses anual ano semana dia dias hoy ayer ahora temporada promocion promociones oferta ofertas descuento descuentos pedido pedidos cliente clientes pago pagos caja transaccion transacciones reporte resumen estadistica estadisticas metrica metricas activa activas activo activos pendiente pendientes futura futuras vigente vigentes existencia existencias cuanto cuestan cuesta vale valen costo costos vender vendido venderse venta outfit look combina combinar recomendado recomienda recomiendame sugerencia sugiere estilo evento gala ocasion ocasion temporada colores talla'.split(' '),
);

const COUNT_RE = /\b(cuant\w*|cantidad(?:es)?|conteo|numero(?:s)?|total(?:es)?)\b/;
const PRICE_RE = /\b(precio|precios|cuesta|cuestan|vale|valen|costo|costos)\b/;
const BUSINESS_RE = /\b(ventas?|vendid[oa]s?|ingresos?|recaud\w*|transacciones?|cajas?|negocio|rendimiento|desempeno|actividad comercial|salud de la tienda)\b/;
const OPERATIONAL_ENTITIES_RE = /\b(clientes?|usuarios?|personal|empleados?|pedidos?|almacenes?|bodegas?|depositos?|pagos?|devoluciones?|reembolsos?|recepciones?|compras?|proveedores?|almacenes?|movimientos?(?:\s+de\s+inventario)?|operaciones?\s+offline|sincronizaciones?|conflictos?|dispositivos?|idempotencia|feed|webhooks?|auditoria|cuentas?\s+por\s+cobrar|deudas?|abonos?|saldos?|propuestas?(?:\s+de\s+producto)?|suscripciones?|modelos?(?:\s+ml)?|predicciones?|notificaciones?|reportes?|interacciones?|conversaciones?(?:\s+ia)?|segmentos?(?:\s+de\s+clientes?)?|reservas?|citas?|sagas?\s+de\s+pago)\b/;
const STATUS_QUESTION_RE = /\b(estado|estatus|saldo|vencid\w*|rechazad\w*|pendient\w*|aprob\w*|reembolsad\w*|fallid\w*|cancelad\w*|entregad\w*|completad\w*|procesad\w*|expirad\w*|pagad\w*|sincronizad\w*|abiert\w*|cerrad\w*|critico|critica|baj\w*|resumen|reporte|metricas?)\b/;

export function normalizeAssistantText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function containsAlias(text: string, aliases: string[]): boolean {
  const padded = ` ${text.replace(/[^a-z0-9]+/g, ' ')} `;
  return aliases.some((alias) => padded.includes(` ${alias} `));
}

export function inferAssistantFilters(question: string): AssistantFilters {
  const normalized = normalizeAssistantText(question);
  const tipo = TIPOS.find((item) => containsAlias(normalized, item.aliases))?.value || null;
  const color = COLORES.find((item) => containsAlias(normalized, item.aliases))?.value || null;
  const sizeMatch = normalized.match(/\b(?:talla|talle|tamano|size)\s*(xxxs|xxs|xxl|xxxl|xs|xl|s|m|l|u|[0-9]{2})\b/);
  const semanticWords = new Set([
    ...TIPOS.flatMap((item) => item.aliases.flatMap((alias) => alias.split(' '))),
    ...COLORES.flatMap((item) => item.aliases.flatMap((alias) => alias.split(' '))),
    'xxxs', 'xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', 'u',
  ]);
  const terminos = [...new Set(normalized.match(/[a-z0-9]+/g) || [])]
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && !semanticWords.has(word) && !/^\d+$/.test(word))
    .slice(0, 5);

  return {
    tipo_prenda: tipo,
    color,
    talla: sizeMatch ? sizeMatch[1].toUpperCase() : null,
    terminos,
  };
}

function asNumber(value: unknown): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function rowNumbers(row: Record<string, any> | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(row || {})) result[key] = asNumber(value);
  return result;
}

function countMap(value: unknown): Record<string, number> {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, number]) => [key, asNumber(number)]),
  );
}

function formatCountMap(value: unknown): string {
  const entries = Object.entries(countMap(value));
  if (!entries.length) return 'sin registros';
  return entries.map(([state, count]) => `${state.replace(/_/g, ' ')}: ${count}`).join(', ');
}

function stringArray(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
}

function jsonObject(value: unknown): Record<string, any> {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return {}; }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, any>
    : {};
}

function jsonArray(value: unknown): Array<Record<string, any>> {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  return Array.isArray(parsed)
    ? parsed.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function isBusinessQuestion(question: string): boolean {
  const q = normalizeAssistantText(question);
  if (/\bprecio de venta\b/.test(q) && !/\b(ventas|ingresos?|recaud\w*|transacciones?)\b/.test(q)) return false;
  if (/\b(mi plan|plan actual|que plan (?:tiene|usa|tenemos)|suscripcion actual|cuando vence)\b/.test(q)) return true;
  if (BUSINESS_RE.test(q)) return true;
  const asksForMetric = COUNT_RE.test(q) || STATUS_QUESTION_RE.test(q) || /\b(cuant\w*|cuanto dinero|cuanta plata)\b/.test(q);
  if (asksForMetric && /\b(stock|inventario)\b/.test(q) && STATUS_QUESTION_RE.test(q)) return true;
  return asksForMetric && OPERATIONAL_ENTITIES_RE.test(q);
}

function isCountQuestion(question: string): boolean {
  const q = normalizeAssistantText(question);
  if (PRICE_RE.test(q)) return false;
  return COUNT_RE.test(q) || /\b(existencia|existencias|cuanto stock|cuanto inventario)\b/.test(q);
}

function isInventoryByBranchQuestion(question: string): boolean {
  const q = normalizeAssistantText(question);
  return /\b(sucursal(?:es)?|local(?:es)?)\b/.test(q) &&
    /\b(stock|inventario|disponible|unidades?|prendas?|productos?|cuant\w*|cantidad)\b/.test(q);
}

function extractBranchCandidate(question: string): string | null {
  const q = normalizeAssistantText(question);
  const marker = /\b(?:sucursal(?:es)?|local(?:es)?)\b/.exec(q);
  if (!marker || marker.index === undefined) return null;
  const rest = q.slice(marker.index + marker[0].length).split(/[?!.,;:]/, 1)[0].trim();
  const words = rest.split(/\s+/).filter(Boolean);
  const connectors = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'esta', 'este', 'en', 'mi', 'nuestra', 'nuestro']);
  const stopAt = new Set([
    'hay', 'tiene', 'tienen', 'vende', 'venden', 'stock', 'inventario', 'disponible', 'disponibles',
    'producto', 'productos', 'prenda', 'prendas', 'ropa', 'cuanto', 'cuanta', 'cuantos', 'cuantas',
    'cantidad', 'numero', 'total', 'horario', 'direccion', 'ubicacion', 'cerca', 'abierta', 'abierto',
    'que', 'como', 'y', 'ahora', 'hoy', 'por', 'para', 'con', 'talla', 'color', 'precio',
  ]);
  while (words.length && connectors.has(words[0])) words.shift();
  if (!words.length || stopAt.has(words[0])) return null;
  const name: string[] = [];
  for (const word of words) {
    if (stopAt.has(word)) break;
    name.push(word);
    if (name.length >= 4) break;
  }
  return name.length ? name.join(' ') : null;
}

function getBranchSelection(question: string, branchRows: Array<Record<string, any>>) {
  const q = normalizeAssistantText(question);
  const candidate = extractBranchCandidate(question);
  const exactMatches = branchRows.filter((row) => {
    const name = normalizeAssistantText(String(row.nombre || '')).trim();
    return name.length >= 3 && q.includes(name);
  });
  const candidateMatches = candidate
    ? branchRows.filter((row) => {
        const name = normalizeAssistantText(String(row.nombre || '')).trim();
        return name.length >= 3 && (name.includes(candidate) || candidate.includes(name));
      })
    : [];
  const matches = exactMatches.length ? exactMatches : candidateMatches;
  const unique = [...new Map(matches.map((row) => [String(row.id), row])).values()];
  const selected = unique.length === 1 ? unique[0] : null;
  const requested = Boolean(selected || (candidate && isInventoryByBranchQuestion(question)));
  return {
    branchId: selected ? Number(selected.id) : null,
    branchName: selected ? String(selected.nombre) : null,
    branchRequested: requested,
    branchNotFound: requested && !selected,
    branchAmbiguous: unique.length > 1,
    branchCandidate: candidate,
  };
}

const STOCK_SCOPE_CTE = `
  WITH stock_scope AS (
    SELECT st.tenant_id, st.variante_id,
           SUM(st.cantidad)::int AS unidades_fisicas,
           SUM(st.reservado)::int AS unidades_reservadas,
           SUM(st.cantidad - st.reservado)::int AS unidades_disponibles
      FROM public.stock st
      JOIN public.almacenes a
        ON a.tenant_id = st.tenant_id AND a.id = st.almacen_id AND a.activo = TRUE
      JOIN public.sucursales suc
        ON suc.tenant_id = a.tenant_id AND suc.id = a.sucursal_id AND suc.activa = TRUE
     WHERE st.tenant_id = $1
       AND (NOT $6::boolean OR ($7::int IS NOT NULL AND a.sucursal_id = $7))
     GROUP BY st.tenant_id, st.variante_id
  )`;

const PRODUCT_FILTER_SQL = `
    p.tenant_id = $1 AND p.activo = TRUE
    AND ($2::text IS NULL OR p.tipo_prenda = $2)
    AND ($3::text IS NULL OR COALESCE(v.color, '') ILIKE '%' || $3 || '%')
    AND ($4::text IS NULL OR UPPER(COALESCE(v.talla, '')) = $4)
    AND (
      NOT $6::boolean OR (
        $7::int IS NOT NULL AND v.id IS NOT NULL AND EXISTS (
          SELECT 1 FROM stock_scope matched_stock
           WHERE matched_stock.tenant_id = p.tenant_id AND matched_stock.variante_id = v.id
        )
      )
    )
    AND (
      cardinality($5::text[]) = 0 OR EXISTS (
        SELECT 1 FROM unnest($5::text[]) AS palabras(termino)
         WHERE p.nombre ILIKE '%' || palabras.termino || '%'
            OR p.codigo ILIKE '%' || palabras.termino || '%'
            OR p.descripcion ILIKE '%' || palabras.termino || '%'
            OR p.material ILIKE '%' || palabras.termino || '%'
            OR COALESCE(c.nombre, '') ILIKE '%' || palabras.termino || '%'
            OR EXISTS (
              SELECT 1 FROM unnest(COALESCE(p.tags, ARRAY[]::text[])) AS etiqueta(valor)
               WHERE etiqueta.valor ILIKE '%' || palabras.termino || '%'
            )
      )
    )`;

function isPrivilegedRole(role: string | null): boolean {
  return role === 'admin' || role === 'encargado';
}

/**
 * Construye un contexto de solo lectura para una sola tienda dentro de la transacción
 * RLS de NestJS. Las consultas son estáticas y parametrizadas: el modelo nunca genera SQL.
 */
export async function buildAssistantDataContext(
  client: PoolClient,
  tenant: TenantInfo,
  question: string,
  userRole: string | null,
  identity: AssistantIdentityScope = { userId: null, branchId: null, providerId: null },
): Promise<Record<string, any>> {
  const filters = inferAssistantFilters(question);
  const branchRowsResult = await client.query(
    `SELECT s.id, s.nombre, s.ciudad, s.direccion, s.horario, s.telefono,
            COUNT(DISTINCT p.id) FILTER (WHERE COALESCE(st.cantidad - st.reservado, 0) > 0)::int AS productos_con_stock,
            COALESCE(SUM(st.cantidad) FILTER (WHERE p.id IS NOT NULL), 0)::int AS unidades_fisicas,
            COALESCE(SUM(st.reservado) FILTER (WHERE p.id IS NOT NULL), 0)::int AS unidades_reservadas,
            COALESCE(SUM(st.cantidad - st.reservado) FILTER (WHERE p.id IS NOT NULL), 0)::int AS unidades_disponibles
       FROM public.sucursales s
       LEFT JOIN public.almacenes a
         ON a.tenant_id = s.tenant_id AND a.sucursal_id = s.id AND a.activo = TRUE
       LEFT JOIN public.stock st
         ON st.tenant_id = a.tenant_id AND st.almacen_id = a.id
       LEFT JOIN public.variantes v
         ON v.tenant_id = st.tenant_id AND v.id = st.variante_id AND v.activa = TRUE
       LEFT JOIN public.productos p
         ON p.tenant_id = v.tenant_id AND p.id = v.producto_id AND p.activo = TRUE
      WHERE s.tenant_id = $1 AND s.activa = TRUE
      GROUP BY s.id
      ORDER BY s.id ASC
      LIMIT 100`,
    [tenant.tenantId],
  );
  const branchSelection = getBranchSelection(question, branchRowsResult.rows as Array<Record<string, any>>);
  const params = [
    tenant.tenantId,
    filters.tipo_prenda,
    filters.color,
    filters.talla,
    filters.terminos,
    branchSelection.branchRequested,
    branchSelection.branchId,
  ];

  const summaryResult = await client.query(
    `WITH stock_scope AS (
       SELECT st.tenant_id, st.variante_id,
              SUM(st.cantidad)::int AS unidades_fisicas,
              SUM(st.reservado)::int AS unidades_reservadas,
              SUM(st.cantidad - st.reservado)::int AS unidades_disponibles
         FROM public.stock st
         JOIN public.almacenes a
           ON a.tenant_id = st.tenant_id AND a.id = st.almacen_id AND a.activo = TRUE
         JOIN public.sucursales suc
           ON suc.tenant_id = a.tenant_id AND suc.id = a.sucursal_id AND suc.activa = TRUE
        WHERE st.tenant_id = $1
        GROUP BY st.tenant_id, st.variante_id
     )
       SELECT COUNT(DISTINCT p.id)::int AS productos_activos,
            COUNT(DISTINCT v.id)::int AS variantes_activas,
            COALESCE(SUM(ss.unidades_fisicas), 0)::int AS unidades_fisicas,
            COALESCE(SUM(ss.unidades_reservadas), 0)::int AS unidades_reservadas,
            COALESCE(SUM(ss.unidades_disponibles), 0)::int AS unidades_disponibles,
            COUNT(DISTINCT CASE WHEN COALESCE(ss.unidades_disponibles, 0) > 0 THEN p.id END)::int AS productos_con_stock,
            (SELECT COUNT(*)::int FROM public.categorias cat WHERE cat.tenant_id = $1 AND cat.activa = TRUE) AS categorias_activas,
            (SELECT COUNT(*)::int FROM public.temporadas tem WHERE tem.tenant_id = $1 AND tem.activa = TRUE) AS temporadas_activas,
            (SELECT COUNT(*)::int FROM public.colecciones col WHERE col.tenant_id = $1 AND col.activa = TRUE) AS colecciones_activas
       FROM public.productos p
       LEFT JOIN public.variantes v
         ON v.tenant_id = p.tenant_id AND v.producto_id = p.id AND v.activa = TRUE
       LEFT JOIN stock_scope ss
         ON ss.tenant_id = v.tenant_id AND ss.variante_id = v.id
      WHERE p.tenant_id = $1 AND p.activo = TRUE`,
    [tenant.tenantId],
  );

  const filteredSummaryResult = await client.query(
    `${STOCK_SCOPE_CTE}
     SELECT COUNT(DISTINCT p.id)::int AS productos,
            COUNT(DISTINCT v.id)::int AS variantes,
            COALESCE(SUM(ss.unidades_fisicas), 0)::int AS unidades_fisicas,
            COALESCE(SUM(ss.unidades_reservadas), 0)::int AS unidades_reservadas,
            COALESCE(SUM(ss.unidades_disponibles), 0)::int AS unidades_disponibles,
            COUNT(DISTINCT CASE WHEN COALESCE(ss.unidades_disponibles, 0) > 0 THEN p.id END)::int AS productos_con_stock
       FROM public.productos p
       LEFT JOIN public.categorias c
         ON c.tenant_id = p.tenant_id AND c.id = p.categoria_id
       LEFT JOIN public.variantes v
         ON v.tenant_id = p.tenant_id AND v.producto_id = p.id AND v.activa = TRUE
       LEFT JOIN stock_scope ss
         ON ss.tenant_id = v.tenant_id AND ss.variante_id = v.id
      WHERE ${PRODUCT_FILTER_SQL}`,
    params,
  );

  const byTypeResult = await client.query(
    `WITH stock_scope AS (
       SELECT st.tenant_id, st.variante_id,
              SUM(st.cantidad - st.reservado)::int AS unidades_disponibles
         FROM public.stock st
         JOIN public.almacenes a
           ON a.tenant_id = st.tenant_id AND a.id = st.almacen_id AND a.activo = TRUE
         JOIN public.sucursales suc
           ON suc.tenant_id = a.tenant_id AND suc.id = a.sucursal_id AND suc.activa = TRUE
        WHERE st.tenant_id = $1
          AND (NOT $2::boolean OR ($3::int IS NOT NULL AND a.sucursal_id = $3))
        GROUP BY st.tenant_id, st.variante_id
     )
     SELECT p.tipo_prenda,
            COUNT(DISTINCT p.id)::int AS productos,
            COUNT(DISTINCT v.id)::int AS variantes,
            COALESCE(SUM(ss.unidades_disponibles), 0)::int AS unidades_disponibles
       FROM public.productos p
       LEFT JOIN public.variantes v
         ON v.tenant_id = p.tenant_id AND v.producto_id = p.id AND v.activa = TRUE
       LEFT JOIN stock_scope ss
         ON ss.tenant_id = v.tenant_id AND ss.variante_id = v.id
      WHERE p.tenant_id = $1 AND p.activo = TRUE
        AND (NOT $2::boolean OR ($3::int IS NOT NULL AND EXISTS (
          SELECT 1 FROM stock_scope scoped
           WHERE scoped.tenant_id = p.tenant_id AND scoped.variante_id = v.id
        )))
      GROUP BY p.tipo_prenda
      ORDER BY p.tipo_prenda`,
    [tenant.tenantId, branchSelection.branchRequested, branchSelection.branchId],
  );

  const orderBy = /\b(barat\w*|econom\w*|menor precio|mas barato)\b/.test(normalizeAssistantText(question))
    ? 'p.precio_base ASC, p.destacado DESC, unidades_disponibles DESC, p.id ASC'
    : /\b(car\w*|costos? altos?|mas caro|mayor precio)\b/.test(normalizeAssistantText(question))
      ? 'p.precio_base DESC, p.destacado DESC, unidades_disponibles DESC, p.id ASC'
      : 'p.destacado DESC, unidades_disponibles DESC, p.id ASC';
  const productRowsResult = await client.query(
    `${STOCK_SCOPE_CTE}
     SELECT p.id, p.nombre, p.codigo, p.tipo_prenda, p.descripcion, p.material, p.tags,
            p.precio_base::float8 AS precio_base, p.imagen_url, p.ar_overlay_url,
            c.nombre AS categoria, v.id AS variante_id, v.sku, v.talla, v.color,
            COALESCE(v.precio_adicional, 0)::float8 AS precio_adicional,
            COALESCE(ss.unidades_fisicas, 0)::int AS unidades_fisicas,
            COALESCE(ss.unidades_reservadas, 0)::int AS unidades_reservadas,
            COALESCE(ss.unidades_disponibles, 0)::int AS unidades_disponibles
       FROM public.productos p
       LEFT JOIN public.categorias c
         ON c.tenant_id = p.tenant_id AND c.id = p.categoria_id
       LEFT JOIN public.variantes v
         ON v.tenant_id = p.tenant_id AND v.producto_id = p.id AND v.activa = TRUE
       LEFT JOIN stock_scope ss
         ON ss.tenant_id = v.tenant_id AND ss.variante_id = v.id
      WHERE ${PRODUCT_FILTER_SQL}
      GROUP BY p.id, c.nombre, v.id, ss.unidades_fisicas, ss.unidades_reservadas, ss.unidades_disponibles
      ORDER BY ${orderBy}
      LIMIT 48`,
    params,
  );

  const promotionsResult = await client.query(
    `SELECT nombre, descripcion, tipo_descuento, valor::float8 AS valor,
            minimo_compra::float8 AS minimo_compra, inicia_en, termina_en,
            COUNT(*) OVER()::int AS total_activas
       FROM public.promociones
      WHERE tenant_id = $1 AND activa = TRUE
        AND inicia_en <= NOW() AND termina_en >= NOW()
      ORDER BY termina_en ASC, id ASC
      LIMIT 12`,
    [tenant.tenantId],
  );
  const promotionCountResult = promotionsResult.rowCount
    ? null
    : await client.query(
        `SELECT COUNT(*)::int AS total_activas
           FROM public.promociones
          WHERE tenant_id = $1 AND activa = TRUE
            AND inicia_en <= NOW() AND termina_en >= NOW()`,
        [tenant.tenantId],
      );

  const catalogMastersResult = await client.query(
    `SELECT
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('nombre', x.nombre, 'tipo_prenda', x.tipo_prenda) ORDER BY x.nombre), '[]'::jsonb)
          FROM (SELECT nombre, tipo_prenda FROM public.categorias
                 WHERE tenant_id = $1 AND activa = TRUE ORDER BY nombre LIMIT 40) x) AS categorias,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('nombre', x.nombre, 'anio', x.anio) ORDER BY x.anio DESC, x.nombre), '[]'::jsonb)
          FROM (SELECT nombre, anio FROM public.temporadas
                 WHERE tenant_id = $1 AND activa = TRUE ORDER BY anio DESC, nombre LIMIT 20) x) AS temporadas,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('nombre', x.nombre, 'temporada', x.temporada) ORDER BY x.nombre), '[]'::jsonb)
          FROM (
            SELECT col.nombre, tem.nombre AS temporada
              FROM public.colecciones col
              LEFT JOIN public.temporadas tem
                ON tem.tenant_id = col.tenant_id AND tem.id = col.temporada_id
             WHERE col.tenant_id = $1 AND col.activa = TRUE
             ORDER BY col.nombre LIMIT 30
          ) x) AS colecciones`,
    [tenant.tenantId],
  );
  const subscriptionPlansResult = await client.query(
    `SELECT COALESCE(jsonb_agg(jsonb_build_object(
       'codigo', x.codigo, 'nombre', x.nombre, 'descripcion', x.descripcion,
       'precio_mensual_bs', x.precio_mensual_bs, 'duracion_dias', x.duracion_dias,
       'max_usuarios', x.max_usuarios, 'max_sucursales', x.max_sucursales,
       'max_productos', x.max_productos, 'facturable', x.facturable,
       'funciones', x.funciones_json) ORDER BY x.max_usuarios), '[]'::jsonb) AS planes
       FROM (SELECT codigo, nombre, descripcion, precio_mensual_bs, duracion_dias,
                    max_usuarios, max_sucursales, max_productos, facturable, funciones_json
               FROM public.planes_suscripcion
              ORDER BY max_usuarios, codigo LIMIT 10) x`,
    [],
  );
  const wantsBusinessData = isBusinessQuestion(question);
  const canReadBusinessData = isPrivilegedRole(userRole);
  let commercial: Record<string, any> | null = null;
  let operational: Record<string, any> | null = null;
  if (wantsBusinessData && canReadBusinessData) {
    const operationalResult = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM public.ventas WHERE tenant_id = $1) AS ventas_total,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.ventas WHERE tenant_id = $1 GROUP BY estado) x) AS ventas_por_estado,
         (SELECT COALESCE(jsonb_object_agg(x.estado_pago, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado_pago, COUNT(*)::int AS cantidad FROM public.ventas WHERE tenant_id = $1 GROUP BY estado_pago) x) AS ventas_por_estado_pago,
         (SELECT COUNT(*)::int FROM public.pagos WHERE tenant_id = $1) AS pagos_total,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.pagos WHERE tenant_id = $1 GROUP BY estado) x) AS pagos_por_estado,
         (SELECT COALESCE(SUM(monto), 0)::float8 FROM public.pagos
           WHERE tenant_id = $1 AND estado = 'aprobado' AND confirmado_proveedor = TRUE) AS pagos_confirmados_bs,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.saga_pago WHERE tenant_id = $1 GROUP BY estado) x) AS saga_pago_por_estado,
         (SELECT COUNT(*)::int FROM public.webhooks_recibidos WHERE tenant_id = $1) AS webhooks_total,
         (SELECT COUNT(*)::int FROM public.webhooks_recibidos WHERE tenant_id = $1 AND procesado = TRUE) AS webhooks_procesados,
         (SELECT COUNT(*)::int FROM public.webhooks_recibidos WHERE tenant_id = $1 AND firma_valida = FALSE) AS webhooks_firma_invalida,
         (SELECT COUNT(*)::int FROM public.devoluciones WHERE tenant_id = $1) AS devoluciones_total,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.devoluciones WHERE tenant_id = $1 GROUP BY estado) x) AS devoluciones_por_estado,
         (SELECT COALESCE(SUM(monto_reembolsado), 0)::float8 FROM public.devoluciones WHERE tenant_id = $1) AS monto_reembolsado_bs,
         (SELECT COUNT(*)::int FROM public.recepciones WHERE tenant_id = $1) AS recepciones_total,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.recepciones WHERE tenant_id = $1 GROUP BY estado) x) AS recepciones_por_estado,
         (SELECT COALESCE(SUM(total_costo), 0)::float8 FROM public.recepciones WHERE tenant_id = $1) AS costo_recepciones_bs,
         (SELECT COUNT(*)::int FROM public.cajas WHERE tenant_id = $1) AS cajas_total,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.cajas WHERE tenant_id = $1 GROUP BY estado) x) AS cajas_por_estado,
         (SELECT COUNT(*)::int FROM public.almacenes WHERE tenant_id = $1 AND activo = TRUE) AS almacenes_activos,
         (SELECT COUNT(*)::int FROM public.proveedores WHERE tenant_id = $1) AS proveedores_total,
         (SELECT COUNT(*)::int FROM public.proveedores WHERE tenant_id = $1 AND activo = TRUE) AS proveedores_activos,
         (SELECT COALESCE(jsonb_agg(x.razon_social), '[]'::jsonb)
            FROM (SELECT razon_social FROM public.proveedores WHERE tenant_id = $1 AND activo = TRUE ORDER BY id LIMIT 30) x) AS proveedores_nombres,
         (SELECT COUNT(*)::int FROM public.usuarios WHERE tenant_id = $1 AND activo = TRUE) AS usuarios_activos,
         (SELECT COALESCE(jsonb_object_agg(x.rol, x.cantidad), '{}'::jsonb)
            FROM (SELECT rol, COUNT(*)::int AS cantidad FROM public.usuarios WHERE tenant_id = $1 AND activo = TRUE GROUP BY rol) x) AS usuarios_activos_por_rol,
         (SELECT COUNT(*)::int FROM public.operaciones_offline WHERE tenant_id = $1) AS operaciones_offline_total,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.operaciones_offline WHERE tenant_id = $1 GROUP BY estado) x) AS operaciones_offline_por_estado,
         (SELECT COUNT(*)::int FROM public.dispositivos_sync WHERE tenant_id = $1 AND activo = TRUE) AS dispositivos_sync_activos,
         (SELECT COUNT(*)::int FROM public.conflictos_sync WHERE tenant_id = $1) AS conflictos_sync_total,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.conflictos_sync WHERE tenant_id = $1 GROUP BY estado) x) AS conflictos_sync_por_estado,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.idempotencia WHERE tenant_id = $1 GROUP BY estado) x) AS idempotencia_por_estado,
         (SELECT COALESCE(jsonb_object_agg(x.accion, x.cantidad), '{}'::jsonb)
            FROM (SELECT accion, COUNT(*)::int AS cantidad FROM public.catalogo_cambios_feed WHERE tenant_id = $1 GROUP BY accion) x) AS feed_catalogo_por_accion,
         (SELECT COUNT(*)::int FROM public.catalogo_cambios_feed WHERE tenant_id = $1) AS feed_catalogo_total,
         (SELECT COUNT(*)::int FROM public.movimientos_inventario WHERE tenant_id = $1) AS movimientos_inventario_total,
         (SELECT COUNT(*)::int FROM public.movimientos_inventario WHERE tenant_id = $1 AND creado_en >= NOW() - INTERVAL '30 days') AS movimientos_inventario_30_dias,
         (SELECT COALESCE(jsonb_object_agg(x.tipo, x.cantidad), '{}'::jsonb)
            FROM (SELECT tipo, COUNT(*)::int AS cantidad FROM public.movimientos_inventario WHERE tenant_id = $1 GROUP BY tipo) x) AS movimientos_por_tipo,
         (SELECT COUNT(*)::int
            FROM public.stock st
            JOIN public.almacenes a ON a.tenant_id = st.tenant_id AND a.id = st.almacen_id AND a.activo = TRUE
            JOIN public.sucursales suc ON suc.tenant_id = a.tenant_id AND suc.id = a.sucursal_id AND suc.activa = TRUE
            JOIN public.variantes v ON v.tenant_id = st.tenant_id AND v.id = st.variante_id AND v.activa = TRUE
            JOIN public.productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id AND p.activo = TRUE
           WHERE st.tenant_id = $1 AND st.cantidad - st.reservado <= st.stock_minimo) AS posiciones_stock_critico,
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('sucursal', x.nombre, 'posiciones', x.posiciones) ORDER BY x.nombre), '[]'::jsonb)
            FROM (
              SELECT suc.nombre, COUNT(*)::int AS posiciones
                FROM public.stock st
                JOIN public.almacenes a ON a.tenant_id = st.tenant_id AND a.id = st.almacen_id AND a.activo = TRUE
                JOIN public.sucursales suc ON suc.tenant_id = a.tenant_id AND suc.id = a.sucursal_id AND suc.activa = TRUE
                JOIN public.variantes v ON v.tenant_id = st.tenant_id AND v.id = st.variante_id AND v.activa = TRUE
                JOIN public.productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id AND p.activo = TRUE
               WHERE st.tenant_id = $1 AND st.cantidad - st.reservado <= st.stock_minimo
               GROUP BY suc.id, suc.nombre
            ) x) AS stock_critico_por_sucursal,
         (SELECT COUNT(*)::int FROM public.cuentas_por_cobrar WHERE tenant_id = $1) AS cuentas_por_cobrar_total,
         (SELECT COUNT(*)::int FROM public.abonos_cuenta WHERE tenant_id = $1) AS abonos_total,
         (SELECT COALESCE(SUM(monto), 0)::float8 FROM public.abonos_cuenta WHERE tenant_id = $1) AS abonos_monto_bs,
         (SELECT COALESCE(jsonb_object_agg(x.metodo_pago, x.cantidad), '{}'::jsonb)
            FROM (SELECT metodo_pago, COUNT(*)::int AS cantidad FROM public.abonos_cuenta WHERE tenant_id = $1 GROUP BY metodo_pago) x) AS abonos_por_metodo,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.cuentas_por_cobrar WHERE tenant_id = $1 GROUP BY estado) x) AS cuentas_por_cobrar_por_estado,
         (SELECT COALESCE(SUM(saldo), 0)::float8 FROM public.cuentas_por_cobrar
           WHERE tenant_id = $1 AND estado <> 'PAGADA') AS saldo_por_cobrar_bs,
         (SELECT COALESCE(SUM(saldo), 0)::float8 FROM public.cuentas_por_cobrar
           WHERE tenant_id = $1 AND estado = 'VENCIDA') AS saldo_vencido_bs,
         (SELECT COUNT(*)::int FROM public.propuestas_producto WHERE tenant_id = $1) AS propuestas_total,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.propuestas_producto WHERE tenant_id = $1 GROUP BY estado) x) AS propuestas_por_estado,
         (SELECT COUNT(*)::int FROM public.suscripciones WHERE tenant_id = $1) AS suscripciones_total,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.suscripciones WHERE tenant_id = $1 GROUP BY estado) x) AS suscripciones_por_estado,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.solicitudes_suscripcion WHERE tenant_id = $1 GROUP BY estado) x) AS solicitudes_suscripcion_por_estado,
         (SELECT jsonb_build_object(
             'codigo', ps.codigo, 'nombre', ps.nombre, 'estado', s.estado,
             'vence_en', s.vence_en, 'modo_cobro', s.modo_cobro,
             'max_usuarios', ps.max_usuarios, 'max_sucursales', ps.max_sucursales,
             'max_productos', ps.max_productos, 'funciones', ps.funciones_json,
             'facturable', ps.facturable)
            FROM public.suscripciones s
            JOIN public.planes_suscripcion ps ON ps.codigo = s.plan_codigo
           WHERE s.tenant_id = $1 LIMIT 1) AS suscripcion_actual,
         (SELECT COUNT(*)::int FROM public.notificaciones WHERE tenant_id = $1 AND leida = FALSE) AS notificaciones_no_leidas,
         (SELECT COUNT(*)::int FROM public.reportes_generados WHERE tenant_id = $1) AS reportes_generados_total,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM public.assistant_aprovisionamiento_estados() x) AS auditoria_aprovisionamiento_por_estado,
         (SELECT COALESCE(jsonb_object_agg(x.accion, x.cantidad), '{}'::jsonb)
            FROM (SELECT accion, COUNT(*)::int AS cantidad FROM public.auditoria WHERE tenant_id = $1 GROUP BY accion) x) AS auditoria_por_accion,
         (SELECT COUNT(*)::int FROM public.auditoria WHERE tenant_id = $1) AS auditoria_total,
         (SELECT COUNT(*)::int FROM public.interacciones WHERE tenant_id = $1) AS interacciones_total,
         (SELECT COALESCE(jsonb_object_agg(x.tipo, x.cantidad), '{}'::jsonb)
            FROM (SELECT tipo, COUNT(*)::int AS cantidad FROM public.interacciones WHERE tenant_id = $1 GROUP BY tipo) x) AS interacciones_por_tipo,
         (SELECT COUNT(*)::int FROM public.conversaciones_ia WHERE tenant_id = $1) AS conversaciones_ia_total,
         (SELECT COALESCE(jsonb_object_agg(x.proveedor_llm, x.cantidad), '{}'::jsonb)
            FROM (SELECT proveedor_llm, COUNT(*)::int AS cantidad FROM public.conversaciones_ia WHERE tenant_id = $1 GROUP BY proveedor_llm) x) AS conversaciones_ia_por_proveedor,
         (SELECT COUNT(*)::int FROM public.segmentos_cliente WHERE tenant_id = $1) AS segmentos_cliente_total,
         (SELECT COALESCE(jsonb_object_agg(x.cluster_id::text, x.cantidad), '{}'::jsonb)
            FROM (SELECT cluster_id, COUNT(*)::int AS cantidad FROM public.segmentos_cliente WHERE tenant_id = $1 GROUP BY cluster_id) x) AS segmentos_cliente_por_cluster,
         (SELECT COUNT(*)::int FROM public.recomendaciones_ia WHERE tenant_id = $1) AS recomendaciones_ia_total,
         (SELECT COUNT(*)::int FROM public.modelos_ml WHERE tenant_id = $1) AS modelos_ml_total,
         (SELECT COALESCE(jsonb_object_agg(x.estado, x.cantidad), '{}'::jsonb)
            FROM (SELECT estado, COUNT(*)::int AS cantidad FROM public.modelos_ml WHERE tenant_id = $1 GROUP BY estado) x) AS modelos_ml_por_estado,
         (SELECT COUNT(*)::int FROM public.predicciones WHERE tenant_id = $1) AS predicciones_total,
         (SELECT COUNT(*)::int FROM public.predicciones WHERE tenant_id = $1 AND es_sintetico = TRUE) AS predicciones_sinteticas` ,
      [tenant.tenantId],
    );
    const op = operationalResult.rows[0] || {};
    operational = {
      ventas: {
        total: asNumber(op.ventas_total),
        por_estado: countMap(op.ventas_por_estado),
        por_estado_pago: countMap(op.ventas_por_estado_pago),
      },
      pagos: {
        total: asNumber(op.pagos_total),
        por_estado: countMap(op.pagos_por_estado),
        monto_confirmado_bs: asNumber(op.pagos_confirmados_bs),
      },
      devoluciones: {
        total: asNumber(op.devoluciones_total),
        por_estado: countMap(op.devoluciones_por_estado),
        monto_reembolsado_bs: asNumber(op.monto_reembolsado_bs),
      },
      recepciones: {
        total: asNumber(op.recepciones_total),
        por_estado: countMap(op.recepciones_por_estado),
        costo_total_bs: asNumber(op.costo_recepciones_bs),
      },
      cajas: { total: asNumber(op.cajas_total), por_estado: countMap(op.cajas_por_estado) },
      almacenes_activos: asNumber(op.almacenes_activos),
      proveedores: {
        total: asNumber(op.proveedores_total),
        activos: asNumber(op.proveedores_activos),
        nombres_activos: stringArray(op.proveedores_nombres),
      },
      usuarios: {
        activos: asNumber(op.usuarios_activos),
        activos_por_rol: countMap(op.usuarios_activos_por_rol),
      },
      operaciones_offline: {
        total: asNumber(op.operaciones_offline_total),
        por_estado: countMap(op.operaciones_offline_por_estado),
      },
      sincronizacion: {
        dispositivos_activos: asNumber(op.dispositivos_sync_activos),
        conflictos_total: asNumber(op.conflictos_sync_total),
        conflictos_por_estado: countMap(op.conflictos_sync_por_estado),
        idempotencia_por_estado: countMap(op.idempotencia_por_estado),
        cambios_catalogo_total: asNumber(op.feed_catalogo_total),
        cambios_catalogo_por_accion: countMap(op.feed_catalogo_por_accion),
      },
      inventario: {
        posiciones_stock_critico: asNumber(op.posiciones_stock_critico),
        stock_critico_por_sucursal: jsonArray(op.stock_critico_por_sucursal),
        movimientos_total: asNumber(op.movimientos_inventario_total),
        movimientos_ultimos_30_dias: asNumber(op.movimientos_inventario_30_dias),
        movimientos_por_tipo: countMap(op.movimientos_por_tipo),
      },
      cuentas_por_cobrar: {
        total: asNumber(op.cuentas_por_cobrar_total),
        por_estado: countMap(op.cuentas_por_cobrar_por_estado),
        saldo_pendiente_bs: asNumber(op.saldo_por_cobrar_bs),
        saldo_vencido_bs: asNumber(op.saldo_vencido_bs),
        abonos_total: asNumber(op.abonos_total),
        abonos_monto_bs: asNumber(op.abonos_monto_bs),
        abonos_por_metodo: countMap(op.abonos_por_metodo),
      },
      propuestas_producto: {
        total: asNumber(op.propuestas_total),
        por_estado: countMap(op.propuestas_por_estado),
      },
      suscripciones: {
        total: asNumber(op.suscripciones_total),
        por_estado: countMap(op.suscripciones_por_estado),
        solicitudes_por_estado: countMap(op.solicitudes_suscripcion_por_estado),
        actual: jsonObject(op.suscripcion_actual),
      },
      notificaciones_no_leidas: asNumber(op.notificaciones_no_leidas),
      reportes_generados: asNumber(op.reportes_generados_total),
      auditoria: {
        total: asNumber(op.auditoria_total),
        por_accion: countMap(op.auditoria_por_accion),
        aprovisionamiento_por_estado: countMap(op.auditoria_aprovisionamiento_por_estado),
      },
      webhooks: {
        total: asNumber(op.webhooks_total),
        procesados: asNumber(op.webhooks_procesados),
        firmas_invalidas: asNumber(op.webhooks_firma_invalida),
      },
      saga_pago_por_estado: countMap(op.saga_pago_por_estado),
      interacciones: { total: asNumber(op.interacciones_total), por_tipo: countMap(op.interacciones_por_tipo) },
      conversaciones_ia: {
        total: asNumber(op.conversaciones_ia_total),
        por_proveedor: countMap(op.conversaciones_ia_por_proveedor),
      },
      recomendaciones_ia: asNumber(op.recomendaciones_ia_total),
      segmentos_cliente: {
        total: asNumber(op.segmentos_cliente_total),
        por_cluster: countMap(op.segmentos_cliente_por_cluster),
      },
      modelos_ml: { total: asNumber(op.modelos_ml_total), por_estado: countMap(op.modelos_ml_por_estado) },
      predicciones_ml: {
        total: asNumber(op.predicciones_total),
        sinteticas: asNumber(op.predicciones_sinteticas),
      },
    };
    const salesResult = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE estado_pago = 'aprobado' AND estado IN ('pagada', 'entregada'))::int AS ventas_confirmadas,
         COALESCE(SUM(total) FILTER (WHERE estado_pago = 'aprobado' AND estado IN ('pagada', 'entregada')), 0)::float8 AS ingresos_confirmados_bs,
         COUNT(*) FILTER (
           WHERE estado NOT IN ('cancelada', 'reembolsada')
             AND (estado = 'pendiente_pago' OR estado_pago IN ('pendiente', 'no_confirmado'))
         )::int AS ventas_pendientes_pago,
         COUNT(*) FILTER (
           WHERE estado_pago = 'aprobado' AND estado IN ('pagada', 'entregada')
             AND creado_en >= (date_trunc('month', NOW() AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'America/La_Paz')
         )::int AS ventas_mes,
         COALESCE(SUM(total) FILTER (
           WHERE estado_pago = 'aprobado' AND estado IN ('pagada', 'entregada')
             AND creado_en >= (date_trunc('month', NOW() AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'America/La_Paz')
         ), 0)::float8 AS ingresos_mes_bs,
         COUNT(*) FILTER (
           WHERE estado_pago = 'aprobado' AND estado IN ('pagada', 'entregada')
             AND creado_en >= (date_trunc('year', NOW() AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'America/La_Paz')
         )::int AS ventas_ano,
         COALESCE(SUM(total) FILTER (
           WHERE estado_pago = 'aprobado' AND estado IN ('pagada', 'entregada')
             AND creado_en >= (date_trunc('year', NOW() AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'America/La_Paz')
         ), 0)::float8 AS ingresos_ano_bs,
         COUNT(*) FILTER (
           WHERE estado_pago = 'aprobado' AND estado IN ('pagada', 'entregada')
             AND creado_en >= (date_trunc('day', NOW() AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'America/La_Paz')
         )::int AS ventas_hoy,
         COALESCE(SUM(total) FILTER (
           WHERE estado_pago = 'aprobado' AND estado IN ('pagada', 'entregada')
             AND creado_en >= (date_trunc('day', NOW() AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'America/La_Paz')
         ), 0)::float8 AS ingresos_hoy_bs
       FROM public.ventas
      WHERE tenant_id = $1`,
      [tenant.tenantId],
    );
    const reservationsResult = await client.query(
      `SELECT COUNT(*) FILTER (WHERE estado IN ('pendiente', 'preparada', 'en_atencion'))::int AS reservas_activas,
              COUNT(*) FILTER (
                WHERE estado IN ('pendiente', 'preparada', 'en_atencion') AND fecha_cita >= NOW()
              )::int AS citas_futuras
         FROM public.reservas
        WHERE tenant_id = $1`,
      [tenant.tenantId],
    );
    const topProductsResult = await client.query(
      `SELECT p.nombre,
              COALESCE(SUM(vi.cantidad), 0)::int AS unidades_vendidas,
              COALESCE(SUM(vi.subtotal), 0)::float8 AS ingresos_bs
         FROM public.productos p
         JOIN public.variantes vr
           ON vr.tenant_id = p.tenant_id AND vr.producto_id = p.id
         JOIN public.venta_items vi
           ON vi.tenant_id = vr.tenant_id AND vi.variante_id = vr.id
         JOIN public.ventas v
           ON v.tenant_id = vi.tenant_id AND v.id = vi.venta_id
          AND v.estado_pago = 'aprobado' AND v.estado IN ('pagada', 'entregada')
        WHERE p.tenant_id = $1 AND p.activo = TRUE
        GROUP BY p.id
        ORDER BY unidades_vendidas DESC, ingresos_bs DESC, p.id ASC
        LIMIT 8`,
      [tenant.tenantId],
    );
    const salesByBranchResult = await client.query(
      `SELECT s.nombre,
              COUNT(v.id)::int AS ventas_confirmadas,
              COALESCE(SUM(v.total), 0)::float8 AS ingresos_confirmados_bs
         FROM public.sucursales s
         LEFT JOIN public.ventas v
           ON v.tenant_id = s.tenant_id AND v.sucursal_id = s.id
          AND v.estado_pago = 'aprobado' AND v.estado IN ('pagada', 'entregada')
        WHERE s.tenant_id = $1 AND s.activa = TRUE
        GROUP BY s.id
        ORDER BY s.id ASC
        LIMIT 20`,
      [tenant.tenantId],
    );
    const customerCountResult = /\b(clientes?|usuarios?)\b/.test(normalizeAssistantText(question))
      ? await client.query(
          `SELECT COUNT(*)::int AS clientes_activos
             FROM public.usuarios
            WHERE tenant_id = $1 AND rol = 'cliente' AND activo = TRUE`,
          [tenant.tenantId],
        )
      : null;
    const paymentMethodsResult = /\b(pagos?|metodos? de pago|forma de pago)\b/.test(normalizeAssistantText(question))
      ? await client.query(
          `SELECT pg.metodo,
                  COUNT(*)::int AS transacciones_confirmadas,
                  COALESCE(SUM(pg.monto), 0)::float8 AS total_confirmado_bs
             FROM public.pagos pg
             JOIN public.ventas v
               ON v.tenant_id = pg.tenant_id AND v.id = pg.venta_id
            WHERE pg.tenant_id = $1 AND pg.estado = 'aprobado'
              AND pg.confirmado_proveedor = TRUE
              AND v.estado_pago = 'aprobado' AND v.estado IN ('pagada', 'entregada')
            GROUP BY pg.metodo
            ORDER BY total_confirmado_bs DESC, pg.metodo
            LIMIT 8`,
          [tenant.tenantId],
        )
      : null;

    commercial = {
      ventas: rowNumbers(salesResult.rows[0]),
      reservas: rowNumbers(reservationsResult.rows[0]),
      productos_mas_vendidos: topProductsResult.rows.map((row: Record<string, any>) => ({
        nombre: String(row.nombre),
        unidades_vendidas: asNumber(row.unidades_vendidas),
        ingresos_bs: asNumber(row.ingresos_bs),
      })),
      ventas_por_sucursal: salesByBranchResult.rows.map((row: Record<string, any>) => ({
        nombre: String(row.nombre),
        ventas_confirmadas: asNumber(row.ventas_confirmadas),
        ingresos_confirmados_bs: asNumber(row.ingresos_confirmados_bs),
      })),
      ...(customerCountResult
        ? { clientes_activos: asNumber(customerCountResult.rows[0]?.clientes_activos) }
        : {}),
      ...(paymentMethodsResult
        ? {
            pagos_por_metodo: paymentMethodsResult.rows.map((row: Record<string, any>) => ({
              metodo: String(row.metodo),
              transacciones_confirmadas: asNumber(row.transacciones_confirmadas),
              total_confirmado_bs: asNumber(row.total_confirmado_bs),
            })),
          }
        : {}),
      datos_personales_clientes: 'No incluidos; solo se comparten agregados comerciales.',
    };
  }

  const promotionCount = promotionCountResult
    ? asNumber(promotionCountResult.rows[0]?.total_activas)
    : asNumber(promotionsResult.rows[0]?.total_activas);
  const businessDetails = await loadAssistantBusinessDetails(
    client,
    tenant.tenantId,
    question,
    userRole,
    identity,
  );

  return sanitizeAssistantContext({
    base_datos_disponible: true,
    actualizado_en: new Date().toISOString(),
    tenant_id: tenant.tenantId,
    tienda: { slug: tenant.tenantSlug, nombre: tenant.nombre },
    acceso: {
      rol: userRole || 'anonimo',
      puede_consultar_metricas_comerciales: canReadBusinessData,
    },
    catalogo: {
      resumen_total: rowNumbers(summaryResult.rows[0]),
      maestros: {
        categorias: jsonArray(catalogMastersResult.rows[0]?.categorias),
        temporadas: jsonArray(catalogMastersResult.rows[0]?.temporadas),
        colecciones: jsonArray(catalogMastersResult.rows[0]?.colecciones),
      },
      productos_por_tipo: byTypeResult.rows.map((row: Record<string, any>) => ({
        tipo_prenda: String(row.tipo_prenda || ''),
        productos: asNumber(row.productos),
        variantes: asNumber(row.variantes),
        unidades_disponibles: asNumber(row.unidades_disponibles),
      })),
      productos_relevantes: productRowsResult.rows.map((row: Record<string, any>) => ({
        id: asNumber(row.id),
        nombre: String(row.nombre || ''),
        codigo: String(row.codigo || ''),
        tipo_prenda: String(row.tipo_prenda || ''),
        descripcion: String(row.descripcion || '').slice(0, 220),
        material: String(row.material || '').slice(0, 100),
        tags: Array.isArray(row.tags) ? row.tags.slice(0, 12).map(String) : [],
        categoria: String(row.categoria || ''),
        precio_base: asNumber(row.precio_base),
        imagen_url: String(row.imagen_url || ''),
        ar_overlay_url: String(row.ar_overlay_url || ''),
        variante: row.variante_id
          ? {
              sku: String(row.sku || ''),
              talla: String(row.talla || ''),
              color: String(row.color || ''),
              precio_adicional: asNumber(row.precio_adicional),
              unidades_fisicas: asNumber(row.unidades_fisicas),
              unidades_reservadas: asNumber(row.unidades_reservadas),
              unidades_disponibles: asNumber(row.unidades_disponibles),
            }
          : null,
      })),
    },
    consulta: {
      filtros_catalogo: {
        ...filters,
        sucursal_id: branchSelection.branchId,
        sucursal_nombre: branchSelection.branchName,
        sucursal_consultada: branchSelection.branchRequested
          ? branchSelection.branchName || branchSelection.branchCandidate
          : null,
        sucursal_no_encontrada: branchSelection.branchNotFound,
        sucursal_ambigua: branchSelection.branchAmbiguous,
      },
      resumen_filtrado: rowNumbers(filteredSummaryResult.rows[0]),
    },
    sucursales: branchRowsResult.rows.map((row: Record<string, any>) => ({
      nombre: String(row.nombre || ''),
      ciudad: String(row.ciudad || ''),
      direccion: String(row.direccion || ''),
      horario: String(row.horario || ''),
      telefono: row.telefono ? String(row.telefono) : null,
      inventario: {
        productos_con_stock: asNumber(row.productos_con_stock),
        unidades_fisicas: asNumber(row.unidades_fisicas),
        unidades_reservadas: asNumber(row.unidades_reservadas),
        unidades_disponibles: asNumber(row.unidades_disponibles),
      },
    })),
    promociones_activas: promotionsResult.rows.map((row: Record<string, any>) => ({
      nombre: String(row.nombre || ''),
      descripcion: String(row.descripcion || '').slice(0, 180),
      tipo_descuento: String(row.tipo_descuento || ''),
      valor: asNumber(row.valor),
      minimo_compra: asNumber(row.minimo_compra),
      inicia_en: row.inicia_en,
      termina_en: row.termina_en,
    })),
    promociones_total: promotionCount,
    planes_suscripcion: jsonArray(subscriptionPlansResult.rows[0]?.planes),
    analitica_comercial: commercial,
    datos_operativos: operational,
    datos_detallados: businessDetails,
  });
}

function productosDesdeContexto(context: Record<string, any>): Array<Record<string, any>> {
  if (!context?.base_datos_disponible) return [];
  const rows = context?.catalogo?.productos_relevantes || [];
  const products = new Map<number, Record<string, any>>();
  for (const row of rows) {
    const id = asNumber(row.id);
    if (!id) continue;
    const current = products.get(id) || {
      id,
      nombre: String(row.nombre || ''),
      tipo_prenda: String(row.tipo_prenda || ''),
      precio_base: asNumber(row.precio_base),
      imagen_url: String(row.imagen_url || ''),
      ar_overlay_url: String(row.ar_overlay_url || ''),
      variantes: [],
      stock_disponible_total: 0,
    };
    if (row.variante) {
      current.variantes.push(row.variante);
      current.stock_disponible_total += asNumber(row.variante.unidades_disponibles);
    }
    products.set(id, current);
  }
  return [...products.values()];
}

export function assistantSuggestedProducts(context: Record<string, any>): Array<Record<string, any>> {
  return productosDesdeContexto(context)
    .filter((product) => asNumber(product.stock_disponible_total) > 0)
    .slice(0, 4)
    .map(({ id, nombre, tipo_prenda, precio_base, imagen_url, ar_overlay_url }) => ({
      id, nombre, tipo_prenda, precio_base, imagen_url, ar_overlay_url,
    }));
}

export function assistantContextSources(context: Record<string, any>): string[] {
  if (!context?.base_datos_disponible) return [];
  const sources = ['catálogo, categorías y colecciones', 'inventario', 'sucursales', 'promociones', 'planes SaaS'];
  if (context.analitica_comercial) sources.push('ventas y reservas agregadas');
  if (context.datos_operativos) sources.push('métricas operativas agregadas');
  const detailed = context.datos_detallados?.fuentes_consultadas;
  if (Array.isArray(detailed) && detailed.length) sources.push(`registros detallados: ${detailed.join(', ')}`);
  return sources;
}

function isAssistantDetailRequest(question: string): boolean {
  const q = normalizeAssistantText(question);
  const listIntent = /\b(lista|listar|muestr\w*|mostrar|detalle|detalles|registros?|ultim\w*|recient\w*|cuales|dame|dime|ver|cuentame|hablame|explicame|informame|mis? (?:ventas?|pedidos?|reservas?|pagos?))\b/.test(q);
  const asksForNamedData = /\b(informacion|datos?)\b.*\b(de|del|sobre)\b/.test(q);
  const asksCount = /\b(cuant\w*|cuanto|cuanta|conteo|cantidad(?:es)?|total(?:es)?|resumen|metricas?)\b/.test(q);
  const asksConcept = /\b(que es|que significa|definicion|concepto de)\b/.test(q);
  const specificStatus = /\b(estado|estatus|situacion|pendiente|vencid\w*|rechazad\w*|aprob\w*|fallid\w*|critico|critica|abiert\w*|cerrad\w*|procesad\w*|sincronizad\w*)\b/.test(q);
  if (asksConcept && !listIntent && !asksForNamedData && !specificStatus && !asksCount) return false;
  const asksAnalysis = /\b(que|como va|como van|como esta|como estan|que paso|que sucede|por que|cuando|cual|cuales|explica|explicame|analiza|historial|cuentame|hablame|informame|quiero saber|necesito saber)\b/.test(q);
  return (listIntent || asksForNamedData || specificStatus || asksAnalysis) && (!asksCount || listIntent || specificStatus);
}

function assistantDetailRecordSummary(dataset: string, row: Record<string, any>): string {
  const date = (value: unknown) => value ? String(value).replace('T', ' ').slice(0, 16) : '';
  const money = (value: unknown) => `Bs. ${asNumber(value).toFixed(2)}`;
  const items = Array.isArray(row.items)
    ? row.items.slice(0, 5).map((item: Record<string, any>) =>
        `${asNumber(item.cantidad)} × ${String(item.producto || 'producto')}${item.talla || item.color ? ` (${[item.talla, item.color].filter(Boolean).join(', ')})` : ''}`,
      ).join('; ')
    : '';
  switch (dataset) {
    case 'ventas':
      return `${row.numero_comprobante || `venta ${row.id}`}: ${row.estado || 'estado no informado'} / pago ${row.estado_pago || 'no informado'}, ${money(row.total_bs)}, ${row.sucursal || 'sucursal no informada'}${row.creado_en ? `, ${date(row.creado_en)}` : ''}${items ? `; artículos: ${items}` : ''}`;
    case 'reservas':
      return `${row.codigo || `reserva ${row.id}`}: ${row.estado || 'estado no informado'}, cita ${date(row.fecha_cita) || 'sin fecha'}, ${row.sucursal || 'sucursal no informada'}${items ? `; artículos: ${items}` : ''}`;
    case 'pagos':
      return `pago ${row.id} (comprobante ${row.numero_comprobante || row.venta_id}): ${row.estado || 'sin estado'}, ${money(row.monto_bs)} por ${row.metodo || 'método no informado'}${row.confirmado_proveedor ? ', confirmado por proveedor' : ''}`;
    case 'devoluciones':
      return `devolución ${row.id} (comprobante ${row.numero_comprobante || row.venta_id}): ${row.estado || 'sin estado'}, reembolso ${money(row.monto_reembolsado_bs)}`;
    case 'recepciones':
      return `recepción ${row.numero_documento || row.id}: ${row.estado || 'sin estado'}, ${money(row.total_costo_bs)}, proveedor ${row.proveedor || 'no informado'}, ${row.sucursal || 'sucursal no informada'}${items ? `; artículos: ${items}` : ''}`;
    case 'cajas':
      return `caja ${row.id}: ${row.estado || 'sin estado'}, efectivo inicial ${money(row.monto_inicial_bs)}, efectivo ventas ${money(row.ventas_efectivo_bs)}, ventas digitales ${money(row.ventas_digitales_bs)}, ${row.sucursal || 'sucursal no informada'}`;
    case 'almacenes':
      return `almacén ${row.nombre || row.codigo || row.id} en ${row.sucursal || 'sucursal no informada'}: ${asNumber(row.unidades_disponibles)} unidades disponibles de ${asNumber(row.unidades_fisicas)} físicas; ${asNumber(row.variantes_con_stock)} variantes con stock${row.es_principal ? '; principal' : ''}${row.activo ? '' : '; inactivo'}`;
    case 'inventario':
      return `${row.producto || 'producto'} ${row.sku || ''} (${[row.talla, row.color].filter(Boolean).join(', ')}), ${row.sucursal || ''}: ${asNumber(row.unidades_disponibles)} disponibles de ${asNumber(row.unidades_fisicas)} físicas; ${asNumber(row.unidades_reservadas)} reservadas; mínimo ${asNumber(row.stock_minimo)}`;
    case 'movimientos_inventario':
      return `movimiento ${row.id}: ${row.tipo || 'tipo no informado'} de ${asNumber(row.cantidad)} unidades de ${row.producto || 'producto'} ${row.sku || ''}, ${row.sucursal || row.almacen || ''}${row.creado_en ? `, ${date(row.creado_en)}` : ''}`;
    case 'proveedores':
      return `${row.razon_social || 'Proveedor'}: ${row.activo ? 'activo' : 'inactivo'}`;
    case 'propuestas_producto':
      return `propuesta ${row.id}, ${row.nombre || 'producto'} (${row.tipo_prenda || ''}, ${row.color || ''}, tallas ${row.tallas_sugeridas || 'no indicadas'}): estado ${row.estado || 'no informado'}, costo ${money(row.costo_propuesto_bs)}, precio sugerido ${money(row.precio_sugerido_bs)}, proveedor ${row.proveedor || 'no indicado'}`;
    case 'cuentas_por_cobrar':
      return `cuenta ${row.id} del comprobante ${row.numero_comprobante || row.venta_id}: saldo ${money(row.saldo_bs)} de ${money(row.monto_original_bs)}, abonado ${money(row.monto_abonado_bs)}, estado ${row.estado || 'no informado'}, vence ${date(row.vence_en) || 'sin fecha'}`;
    case 'abonos':
      return `abono ${row.id} de la cuenta ${row.cuenta_id}: ${money(row.monto_bs)} por ${row.metodo_pago || 'método no informado'}${row.creado_en ? `, ${date(row.creado_en)}` : ''}`;
    case 'suscripciones':
      return `${row.tipo_registro === 'solicitud' ? 'solicitud' : 'suscripción'} ${row.plan_nombre || row.plan_solicitado || row.plan_codigo || ''}: ${row.estado || 'sin estado'}${row.vence_en ? `, vence ${date(row.vence_en)}` : ''}`;
    case 'sincronizacion':
      if (row.tipo_registro === 'dispositivo') return `dispositivo ${row.etiqueta || row.plataforma || 'sin etiqueta'} (${row.plataforma || 'plataforma no informada'}): ${row.activo ? 'activo' : 'inactivo'}, última sincronización ${date(row.ultima_sync_en) || 'sin sincronización registrada'}`;
      if (row.tipo_registro === 'cambio_catalogo') return `cambio de catálogo ${row.entidad || 'entidad'} ${row.entidad_id || ''}: ${row.accion || 'acción no informada'}${row.actualizado_en ? `, ${date(row.actualizado_en)}` : ''}`;
      if (row.tipo_registro === 'idempotencia') return `operación idempotente: ${row.estado || 'sin estado'}${row.actualizado_en ? `, ${date(row.actualizado_en)}` : ''}`;
      return `operación ${row.operacion || ''} (${row.tipo || ''}): ${row.estado || 'sin estado'}${row.conflicto_estado ? `, conflicto ${row.conflicto_estado}` : ''}${row.creado_en ? `, ${date(row.creado_en)}` : ''}`;
    case 'webhooks':
      return `webhook ${row.provider || ''}: ${row.procesado ? 'procesado' : 'pendiente'}, firma ${row.firma_valida ? 'válida' : 'inválida'}, ${money(row.monto_bs)}${row.recibido_en ? `, ${date(row.recibido_en)}` : ''}`;
    case 'sagas_pago':
      return `saga de pago: ${row.estado || 'sin estado'}, paso ${row.paso_actual || 'no informado'}, ${asNumber(row.intentos)} intentos`;
    case 'auditoria':
      return `evento de ${row.entidad || 'entidad'}: ${row.accion || 'acción no informada'}${row.creado_en ? `, ${date(row.creado_en)}` : ''}`;
    case 'modelos_ml':
      return `modelo ${row.algoritmo || ''} v${row.version || ''}: ${row.estado || 'sin estado'}${row.metricas ? `, métricas ${JSON.stringify(row.metricas)}` : ''}`;
    case 'predicciones_ml':
      return `predicción de ${row.entidad_tipo || 'entidad'}${row.es_sintetico ? ' (sintética)' : ''}${row.creado_en ? `, ${date(row.creado_en)}` : ''}`;
    case 'segmentos_cliente':
      return `segmento/cluster ${row.cluster_id}${row.es_sintetico ? ' (sintético)' : ''}${row.creado_en ? `, ${date(row.creado_en)}` : ''}`;
    case 'reportes':
      return `reporte mediante ${row.motor || 'motor no informado'}${row.creado_en ? `, ${date(row.creado_en)}` : ''}`;
    case 'notificaciones':
      return `${row.titulo || 'Notificación'} (${row.tipo || 'info'}): ${row.leida ? 'leída' : 'no leída'}${row.creado_en ? `, ${date(row.creado_en)}` : ''}`;
    case 'actividad_ia':
      return `${row.tipo_registro || 'actividad IA'}${row.intencion ? `, intención ${row.intencion}` : ''}${row.proveedor_llm ? `, proveedor ${row.proveedor_llm}` : ''}${row.creado_en ? `, ${date(row.creado_en)}` : ''}`;
    case 'usuarios_agregado':
      return `rol ${row.rol || 'no informado'}: ${row.activo ? 'activo' : 'inactivo'}`;
    default:
      return '';
  }
}

function assistantDetailsReply(question: string, context: Record<string, any>): string | null {
  if (!isAssistantDetailRequest(question)) return null;
  const details = context?.datos_detallados;
  const keys: string[] = Array.isArray(details?.fuentes_consultadas) ? details.fuentes_consultadas : [];
  const selectedKeys = keys.filter((key) => details?.registros?.[key]).slice(0, 3);
  if (!selectedKeys.length) return null;
  const sections = selectedKeys.map((dataset) => {
    const result = details.registros[dataset];
    const label = dataset.replace(/_/g, ' ');
    if (!Array.isArray(result?.filas) || result.filas.length === 0) {
      return `Consulté los registros permitidos de ${label}: no hay registros que mostrar para esta tienda/usuario.`;
    }
    const summaries = result.filas.slice(0, 6)
      .map((row: Record<string, any>) => assistantDetailRecordSummary(dataset, row))
      .filter(Boolean);
    const total = asNumber(result.total);
    const shown = Math.min(result.filas.length, 6);
    const suffix = result.truncado
      ? ` Se muestran ${shown} registros recientes de ${total}; puedes acotar por fecha o identificador.`
      : ` Se muestran ${shown}${total ? ` de ${total}` : ''} registro${shown === 1 ? '' : 's'}.`;
    return `${label}: ${summaries.join(' | ')}.${suffix}`;
  });
  return sections.join('\n');
}

export function buildAssistantLocalReply(question: string, context: Record<string, any>): string {
  if (!context?.base_datos_disponible) {
    return 'Ahora no pude consultar la base de datos de esta tienda; no voy a inventar cantidades, precios o ventas. Inténtalo de nuevo en unos minutos.';
  }
  const q = normalizeAssistantText(question);
  const tenantName = String(context?.tienda?.nombre || context?.tienda?.slug || 'esta tienda');
  const filters = context?.consulta?.filtros_catalogo || {};
  const products = productosDesdeContexto(context);
  const commercial = context?.analitica_comercial;
  const detailReply = assistantDetailsReply(question, context);
  if (detailReply) return detailReply;
  if (/\b(que|cuales).{0,50}\b(datos?|informacion|fuentes?)\b.{0,40}\b(consult\w*|acced\w*|tienes|puedes|disponibles?)\b/.test(q)) {
    const sources = context?.datos_detallados?.fuentes_disponibles;
    return `Para tu sesión/rol puedo consultar: ${Array.isArray(sources) && sources.length ? sources.join('; ') : 'solo la información pública del catálogo'}. La respuesta se limita a esta tienda y a datos de negocio autorizados; no envío credenciales ni datos personales de clientes a la IA.`;
  }

  if (isBusinessQuestion(question)) {
    if (!context?.acceso?.puede_consultar_metricas_comerciales) {
      return 'Las métricas agregadas de ventas, ingresos, reservas y clientes requieren iniciar sesión con rol de administrador o encargado. No expongo datos comerciales a visitantes.';
    }
    if (!commercial) {
      return 'No pude obtener esas métricas en esta consulta; no voy a estimarlas. Intenta de nuevo o genera un reporte desde el panel.';
    }
    const operations = context.datos_operativos || {};
    if (/\b(mi plan|plan actual|que plan (?:tiene|usa|tenemos)|suscripcion actual|cuando vence)\b/.test(q)) {
      const plan = operations.suscripciones?.actual || {};
      if (!plan.codigo) return `No encontré una suscripción activa vinculada a ${tenantName} en la base.`;
      const productsLimit = asNumber(plan.max_productos) < 0 ? 'sin límite configurado' : `${asNumber(plan.max_productos)} productos`;
      return `${tenantName} está en el plan ${plan.nombre || plan.codigo} (${plan.codigo}), estado ${plan.estado || 'no informado'}; vence ${plan.vence_en || 'sin fecha registrada'}. Límites configurados: ${asNumber(plan.max_usuarios)} usuarios, ${asNumber(plan.max_sucursales)} sucursales y ${productsLimit}. La base marca facturable=${Boolean(plan.facturable)}; esto no confirma ningún cobro.`;
    }
    if (/\bclientes?\b/.test(q) && commercial.clientes_activos != null) {
      return `La base registra ${asNumber(commercial.clientes_activos)} clientes activos en ${tenantName}. No consulté ni expuse datos personales.`;
    }
    if (/\b(usuarios?|personal|empleados?)\b/.test(q)) {
      const users = operations.usuarios || {};
      return `La base registra ${asNumber(users.activos)} usuarios activos; conteo agregado por rol: ${formatCountMap(users.activos_por_rol)}. No expongo nombres ni datos personales.`;
    }
    if (/\breservas?\b/.test(q)) {
      return `En ${tenantName} hay ${asNumber(commercial.reservas?.reservas_activas)} reservas activas, de las cuales ${asNumber(commercial.reservas?.citas_futuras)} tienen cita futura.`;
    }
    if (/\b(devoluciones?|reembolsos?)\b/.test(q)) {
      const returns = operations.devoluciones || {};
      return `La base registra ${asNumber(returns.total)} devoluciones; estados: ${formatCountMap(returns.por_estado)}. El monto reembolsado acumulado es Bs. ${asNumber(returns.monto_reembolsado_bs).toFixed(2)}.`;
    }
    if (/\b(pagos?)\b/.test(q) && !/\b(metodo|metodos|forma|formas)\b/.test(q)) {
      const payments = operations.pagos || {};
      return `La base registra ${asNumber(payments.total)} pagos; estados: ${formatCountMap(payments.por_estado)}. Monto aprobado y confirmado por el proveedor: Bs. ${asNumber(payments.monto_confirmado_bs).toFixed(2)}.`;
    }
    if (/\b(recepciones?|compras?)\b/.test(q)) {
      const receipts = operations.recepciones || {};
      return `La base registra ${asNumber(receipts.total)} recepciones; estados: ${formatCountMap(receipts.por_estado)}. Costo total registrado de recepciones: Bs. ${asNumber(receipts.costo_total_bs).toFixed(2)}.`;
    }
    if (/\b(cajas?|turnos?)\b/.test(q)) {
      const registers = operations.cajas || {};
      return `La base registra ${asNumber(registers.total)} cajas; estados: ${formatCountMap(registers.por_estado)}.`;
    }
    if (/\b(proveedores?)\b/.test(q)) {
      const suppliers = operations.proveedores || {};
      const names = Array.isArray(suppliers.nombres_activos) ? suppliers.nombres_activos.slice(0, 12).join(', ') : '';
      return `Hay ${asNumber(suppliers.activos)} proveedores activos de ${asNumber(suppliers.total)} registrados${names ? `: ${names}` : ''}. No expongo datos de contacto.`;
    }
    if (/\b(almacenes?)\b/.test(q)) {
      return `Hay ${asNumber(operations.almacenes_activos)} almacenes activos registrados en ${tenantName}.`;
    }
    if (/\b(operaciones?\s+offline|sincronizaciones?|conflictos?|dispositivos?|idempotencia|feed)\b/.test(q)) {
      const offline = operations.operaciones_offline || {};
      const sync = operations.sincronizacion || {};
      return `Sincronización: ${asNumber(offline.total)} operaciones offline (${formatCountMap(offline.por_estado)}); ${asNumber(sync.dispositivos_activos)} dispositivos activos; ${asNumber(sync.conflictos_total)} conflictos (${formatCountMap(sync.conflictos_por_estado)}); idempotencia: ${formatCountMap(sync.idempotencia_por_estado)}; ${asNumber(sync.cambios_catalogo_total)} cambios de catálogo (${formatCountMap(sync.cambios_catalogo_por_accion)}).`;
    }
    if (/\b(webhooks?|sagas?\s+de\s+pago)\b/.test(q)) {
      const hooks = operations.webhooks || {};
      return `Pagos durables: estados de saga ${formatCountMap(operations.saga_pago_por_estado)}; webhooks recibidos ${asNumber(hooks.total)}, procesados ${asNumber(hooks.procesados)}, con firma inválida ${asNumber(hooks.firmas_invalidas)}. No consulté ni expuse payloads, secretos o referencias.`;
    }
    if (/\b(auditoria|aprovisionamiento)\b/.test(q)) {
      const audit = operations.auditoria || {};
      return `Auditoría agregada: ${asNumber(audit.total)} eventos (${formatCountMap(audit.por_accion)}); aprovisionamiento por estado: ${formatCountMap(audit.aprovisionamiento_por_estado)}. No consulté IP, contenido ni datos de eventos.`;
    }
    if (/\b(movimientos?)\b/.test(q)) {
      const inventory = operations.inventario || {};
      return `La base registra ${asNumber(inventory.movimientos_total)} movimientos de inventario, ${asNumber(inventory.movimientos_ultimos_30_dias)} en los últimos 30 días; por tipo: ${formatCountMap(inventory.movimientos_por_tipo)}.`;
    }
    if (/\b(cuentas?\s+por\s+cobrar|deudas?|abonos?)\b/.test(q) || /\bsaldo(?:\s+(?:pendiente|vencido))?\b/.test(q)) {
      const receivables = operations.cuentas_por_cobrar || {};
      const balance = `Hay ${asNumber(receivables.total)} cuentas por cobrar; estados: ${formatCountMap(receivables.por_estado)}. Saldo pendiente: Bs. ${asNumber(receivables.saldo_pendiente_bs).toFixed(2)}; saldo vencido: Bs. ${asNumber(receivables.saldo_vencido_bs).toFixed(2)}.`;
      if (/\babonos?\b/.test(q)) {
        return `${balance} Se registran ${asNumber(receivables.abonos_total)} abonos por Bs. ${asNumber(receivables.abonos_monto_bs).toFixed(2)}; métodos: ${formatCountMap(receivables.abonos_por_metodo)}.`;
      }
      return balance;
    }
    if (/\b(stock|inventario)\b/.test(q) && STATUS_QUESTION_RE.test(q)) {
      const inventory = operations.inventario || {};
      const byBranch = Array.isArray(inventory.stock_critico_por_sucursal) ? inventory.stock_critico_por_sucursal : [];
      if (filters.sucursal_no_encontrada) {
        return `No encontré una sucursal activa llamada “${filters.sucursal_consultada || 'esa'}” para revisar el stock crítico.`;
      }
      if (filters.sucursal_nombre) {
        const row = byBranch.find((item: Record<string, any>) => item.sucursal === filters.sucursal_nombre);
        return `${filters.sucursal_nombre} tiene ${asNumber(row?.posiciones)} posiciones de inventario en o bajo su punto mínimo.`;
      }
      if (/\b(sucursal|sucursales|local|locales)\b/.test(q) && byBranch.length) {
        const ranking = [...byBranch].sort((a: Record<string, any>, b: Record<string, any>) => asNumber(b.posiciones) - asNumber(a.posiciones));
        return `Posiciones de stock crítico por sucursal: ${ranking.map((row: Record<string, any>) => `${row.sucursal}: ${asNumber(row.posiciones)}`).join('; ')}.`;
      }
      return `Hay ${asNumber(inventory.posiciones_stock_critico)} posiciones de inventario en o bajo su punto mínimo, según la última consulta a la base.`;
    }
    if (/\b(propuestas?)\b/.test(q)) {
      const proposals = operations.propuestas_producto || {};
      return `Hay ${asNumber(proposals.total)} propuestas de producto; estados: ${formatCountMap(proposals.por_estado)}.`;
    }
    if (/\b(suscripciones?|planes?|solicitudes?\s+de\s+suscripcion)\b/.test(q)) {
      const subscriptions = operations.suscripciones || {};
      const current = subscriptions.actual || {};
      const currentLabel = current.codigo ? ` Plan actual: ${current.nombre || current.codigo} (${current.estado || 'estado no informado'}).` : '';
      return `La tienda registra ${asNumber(subscriptions.total)} suscripciones; estados: ${formatCountMap(subscriptions.por_estado)}. Solicitudes de cambio de plan: ${formatCountMap(subscriptions.solicitudes_por_estado)}.${currentLabel}`;
    }
    if (/\b(notificaciones?)\b/.test(q)) {
      return `La base registra ${asNumber(operations.notificaciones_no_leidas)} notificaciones no leídas para esta tienda. No consulté mensajes personales.`;
    }
    if (/\b(reportes?)\b/.test(q)) {
      return `La base registra ${asNumber(operations.reportes_generados)} reportes generados.`;
    }
    if (/\b(interacciones?|recomendaciones?\s+ia|modelos?(?:\s+ml)?|predicciones?|conversaciones?(?:\s+ia)?|segmentos?(?:\s+de\s+clientes?)?)\b/.test(q)) {
      return `IA/analítica en la base: ${asNumber(operations.interacciones?.total)} interacciones; ${asNumber(operations.recomendaciones_ia)} recomendaciones; ${asNumber(operations.conversaciones_ia?.total)} conversaciones IA (${formatCountMap(operations.conversaciones_ia?.por_proveedor)}); ${asNumber(operations.modelos_ml?.total)} modelos ML (${formatCountMap(operations.modelos_ml?.por_estado)}); ${asNumber(operations.predicciones_ml?.total)} predicciones, de las cuales ${asNumber(operations.predicciones_ml?.sinteticas)} están marcadas sintéticas; ${asNumber(operations.segmentos_cliente?.total)} segmentos de clientes. No consulté mensajes ni perfiles personales.`;
    }
    if (/\b(negocio|rendimiento|desempeno|actividad comercial|salud de la tienda|estado general|resumen de la tienda|como va (?:el negocio|la tienda)|como esta (?:el negocio|la tienda))\b/.test(q)) {
      const sales = commercial.ventas || {};
      const returns = operations.devoluciones || {};
      const payments = operations.pagos || {};
      const inventory = operations.inventario || {};
      const offline = operations.operaciones_offline || {};
      return (
        `Resumen de ${tenantName}, consultado en la base de datos: ${asNumber(sales.ventas_confirmadas)} ventas con pago confirmado ` +
        `por Bs. ${asNumber(sales.ingresos_confirmados_bs).toFixed(2)}; ${asNumber(sales.ventas_pendientes_pago)} pedidos pendientes de pago. ` +
        `Hay ${asNumber(payments.total)} pagos registrados (estados: ${formatCountMap(payments.por_estado)}); ` +
        `${asNumber(returns.total)} devoluciones registradas (estados: ${formatCountMap(returns.por_estado)}). ` +
        `El inventario presenta ${asNumber(inventory.posiciones_stock_critico)} posiciones en o bajo el mínimo; ` +
        `hay ${asNumber(offline.total)} operaciones offline registradas (${formatCountMap(offline.por_estado)}). ` +
        `Es un resumen de los indicadores disponibles, no una evaluación contable completa.`
      );
    }
    if (/\b(ventas?|pedidos?)\b/.test(q) && STATUS_QUESTION_RE.test(q)) {
      const sales = operations.ventas || {};
      return `La base registra ${asNumber(sales.total)} ventas/pedidos. Estados de la venta: ${formatCountMap(sales.por_estado)}; estados de pago: ${formatCountMap(sales.por_estado_pago)}.`;
    }
    if (/\b(mas vendido|mas vendida|top|ranking)\b/.test(q) && commercial.productos_mas_vendidos?.length) {
      const top = commercial.productos_mas_vendidos.slice(0, 5)
        .map((product: Record<string, any>) => `${product.nombre}: ${asNumber(product.unidades_vendidas)} unidades`)
        .join('; ');
      return `Según las ventas con pago confirmado, los productos más vendidos son: ${top}.`;
    }
    if (/\b(sucursal|local)\b/.test(q) && /\b(venta|ingreso|recaud)\w*\b/.test(q) && commercial.ventas_por_sucursal?.length) {
      const rows = commercial.ventas_por_sucursal.slice(0, 8)
        .map((branch: Record<string, any>) => `${branch.nombre}: ${asNumber(branch.ventas_confirmadas)} ventas, Bs. ${asNumber(branch.ingresos_confirmados_bs).toFixed(2)}`)
        .join('; ');
      return `Ventas confirmadas por sucursal: ${rows}.`;
    }
    if (/\b(metodo|metodos|forma|formas)\b/.test(q) && commercial.pagos_por_metodo) {
      if (!commercial.pagos_por_metodo.length) return 'No hay pagos aprobados con confirmación registrada para desglosar por método.';
      return 'Pagos aprobados y confirmados por método: ' + commercial.pagos_por_metodo.slice(0, 8)
        .map((row: Record<string, any>) => `${row.metodo}: ${asNumber(row.transacciones_confirmadas)} transacciones, Bs. ${asNumber(row.total_confirmado_bs).toFixed(2)}`)
        .join('; ') + '.';
    }
    if (/\b(hoy|dia)\b/.test(q)) {
      return `Hoy, ${tenantName} registra ${asNumber(commercial.ventas?.ventas_hoy)} ventas con pago confirmado e ingresos confirmados de Bs. ${asNumber(commercial.ventas?.ingresos_hoy_bs).toFixed(2)}.`;
    }
    if (/\b(mes|mensual)\b/.test(q)) {
      return `Este mes, ${tenantName} registra ${asNumber(commercial.ventas?.ventas_mes)} ventas con pago confirmado e ingresos confirmados de Bs. ${asNumber(commercial.ventas?.ingresos_mes_bs).toFixed(2)}.`;
    }
    if (/\b(ano|anual)\b/.test(q)) {
      return `En lo que va del año, ${tenantName} registra ${asNumber(commercial.ventas?.ventas_ano)} ventas con pago confirmado e ingresos confirmados de Bs. ${asNumber(commercial.ventas?.ingresos_ano_bs).toFixed(2)}.`;
    }
    return `En ${tenantName} hay ${asNumber(commercial.ventas?.ventas_confirmadas)} ventas con pago confirmado por Bs. ${asNumber(commercial.ventas?.ingresos_confirmados_bs).toFixed(2)} en total. Hay ${asNumber(commercial.ventas?.ventas_pendientes_pago)} pedidos pendientes de pago.`;
  }

  if (filters.sucursal_ambigua) {
    return 'Hay más de una sucursal que coincide con ese nombre. Dime el nombre completo para consultar el inventario correcto.';
  }
  if (filters.sucursal_no_encontrada) {
    return `No encontré una sucursal activa llamada “${filters.sucursal_consultada || 'esa'}” en ${tenantName}; no voy a mostrar el inventario de otra sucursal por error.`;
  }

  if (isCountQuestion(question)) {
    if (/\b(promocion|promociones|oferta|ofertas|descuento|descuentos)\b/.test(q)) {
      return `Hay ${asNumber(context.promociones_total)} promociones activas registradas ahora en ${tenantName}.`;
    }
    if (/\b(sucursal|sucursales|local|locales)\b/.test(q) && !/\b(prenda|prendas|producto|productos|stock|inventario|disponible|unidad|unidades)\b/.test(q)) {
      return `Hay ${Array.isArray(context.sucursales) ? context.sucursales.length : 0} sucursales activas registradas en ${tenantName}.`;
    }
    if (/\bplanes?\b/.test(q)) return `Hay ${(context?.planes_suscripcion || []).length} planes de suscripción configurados en la base.`;
    const total = context?.catalogo?.resumen_total || {};
    if (/\bcategorias?\b/.test(q)) return `Hay ${asNumber(total.categorias_activas)} categorías activas registradas en ${tenantName}.`;
    if (/\btemporadas?\b/.test(q)) return `Hay ${asNumber(total.temporadas_activas)} temporadas activas registradas en ${tenantName}.`;
    if (/\bcolecciones?\b/.test(q)) return `Hay ${asNumber(total.colecciones_activas)} colecciones activas registradas en ${tenantName}.`;
    const filtered = Boolean(filters.tipo_prenda || filters.color || filters.talla || filters.terminos?.length || filters.sucursal_id || filters.sucursal_no_encontrada);
    const data = filtered ? context?.consulta?.resumen_filtrado || {} : total;
    const countProducts = asNumber(filtered ? data.productos : data.productos_activos);
    const countVariants = asNumber(filtered ? data.variantes : data.variantes_activas);
    const detail = [
      filters.tipo_prenda,
      filters.color,
      filters.talla ? `talla ${filters.talla}` : null,
      filters.sucursal_nombre ? `sucursal ${filters.sucursal_nombre}` : null,
      ...(filters.terminos || []),
    ].filter(Boolean).join(' ');
    const intro = filtered
      ? `Con esos filtros${detail ? ` (${detail})` : ''}, `
      : 'En el catálogo activo, ';
    return `${intro}${tenantName} tiene ${countProducts} productos, ${countVariants} variantes/SKU y ${asNumber(data.unidades_disponibles)} unidades disponibles (${asNumber(data.unidades_fisicas)} físicas y ${asNumber(data.unidades_reservadas)} reservadas).`;
  }

  const catalogueMasters = context?.catalogo?.maestros || {};
  if (/\bcategorias?\b/.test(q)) {
    const names = (catalogueMasters.categorias || []).slice(0, 20).map((item: Record<string, any>) => item.nombre).filter(Boolean);
    return names.length ? `Categorías activas consultadas en la base: ${names.join(', ')}.` : 'No hay categorías activas registradas en la base.';
  }
  if (/\btemporadas?\b/.test(q)) {
    const names = (catalogueMasters.temporadas || []).slice(0, 20).map((item: Record<string, any>) => `${item.nombre}${item.anio ? ` ${item.anio}` : ''}`).filter(Boolean);
    return names.length ? `Temporadas activas consultadas en la base: ${names.join(', ')}.` : 'No hay temporadas activas registradas en la base.';
  }
  if (/\bcolecciones?\b/.test(q)) {
    const names = (catalogueMasters.colecciones || []).slice(0, 20).map((item: Record<string, any>) => `${item.nombre}${item.temporada ? ` (${item.temporada})` : ''}`).filter(Boolean);
    return names.length ? `Colecciones activas consultadas en la base: ${names.join(', ')}.` : 'No hay colecciones activas registradas en la base.';
  }
  if (/\bplanes?\b/.test(q)) {
    const plans = context?.planes_suscripcion || [];
    if (!plans.length) return 'No pude consultar los planes configurados en la base; no voy a inventar sus condiciones.';
    return 'Planes configurados en la base: ' + plans.slice(0, 10).map((plan: Record<string, any>) =>
      `${plan.nombre} (${plan.codigo}; hasta ${asNumber(plan.max_usuarios)} usuarios, ${asNumber(plan.max_sucursales)} sucursales, ${asNumber(plan.max_productos) < 0 ? 'sin límite de productos' : `${asNumber(plan.max_productos)} productos`}; precio de lista Bs. ${asNumber(plan.precio_mensual_bs).toFixed(2)}, facturable=${Boolean(plan.facturable)})`
    ).join('; ') + '. Los campos de precio describen el plan guardado y no confirman que exista un cobro real.';
  }

  if (/\b(sucursal|sucursales|local|locales|direccion|horario|ubicacion|donde)\b/.test(q)) {
    const branches = context?.sucursales || [];
    if (!branches.length) return 'No hay sucursales activas registradas en la base de datos de esta tienda.';
    const selected = filters.sucursal_id
      ? branches.filter((branch: Record<string, any>) => branch.nombre === filters.sucursal_nombre)
      : branches;
    return 'Sucursales activas registradas: ' + selected.slice(0, 8).map((branch: Record<string, any>) =>
      `${branch.nombre} (${branch.direccion}, ${branch.ciudad}; horario ${branch.horario})`
    ).join('; ') + '.';
  }

  if (/\b(promocion|promociones|oferta|ofertas|descuento|descuentos)\b/.test(q)) {
    const promotions = context?.promociones_activas || [];
    if (!promotions.length) return `Consulté la base de ${tenantName}: no hay promociones activas registradas ahora.`;
    return 'Promociones activas: ' + promotions.slice(0, 5).map((promotion: Record<string, any>) =>
      `${promotion.nombre} (${asNumber(promotion.valor)}${promotion.tipo_descuento === 'porcentaje' ? '%' : ' Bs.'}${asNumber(promotion.minimo_compra) ? `; mínimo Bs. ${asNumber(promotion.minimo_compra).toFixed(2)}` : ''})`
    ).join('; ') + '.';
  }

  if (/\b(stock|inventario|disponible|talla|color|precio|catalogo|prenda|producto|vestido|blusa|camiseta|chaqueta|pantalon|falda|cartera|zapato)\b/.test(q)) {
    if (!products.length) return 'No encontré productos activos que coincidan con esos filtros en la base de datos de esta tienda.';
    return 'Consulté el catálogo e inventario actuales: ' + products.slice(0, 4).map((product) => {
      const variants = (product.variantes || []).slice(0, 3).map((variant: Record<string, any>) => {
        const finalPrice = asNumber(product.precio_base) + asNumber(variant.precio_adicional);
        const priceInfo = asNumber(variant.precio_adicional) ? `, Bs. ${finalPrice.toFixed(2)}` : '';
        return `${variant.talla} ${variant.color}: ${asNumber(variant.unidades_disponibles)} disponibles${priceInfo}`;
      }).join(', ');
      return `${product.nombre}, precio base Bs. ${asNumber(product.precio_base).toFixed(2)}, ${asNumber(product.stock_disponible_total)} unidades disponibles${variants ? ` (${variants})` : ''}`;
    }).join('; ') + '.';
  }

  if (/\b(combin\w*|outfit|recomiend\w*|recomend\w*|sugier\w*|look|vestir|estilo)\b/.test(q) && products.length) {
    return `Según el catálogo actual de ${tenantName}, puedo partir de estas prendas: ${products.slice(0, 3).map((product) => product.nombre).join(', ')}. Dime la ocasión, color y presupuesto para afinar la combinación.`;
  }

  return `Soy el asistente de ${tenantName}. Consulto el catálogo, precios base, stock por talla/color y sucursal, horarios, promociones y, para administradores o encargados, métricas comerciales agregadas. Si preguntas por una cifra, te indicaré el dato consultado en la base.`;
}
