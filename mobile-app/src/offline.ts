/**
 * Persistencia offline-first para la app móvil FashionStore (expo-sqlite).
 *
 * - Cola durable `outbox` con ID generado ANTES del envío, hash SHA-256 del payload,
 *   clave de idempotencia (`operacion_offline_id`), estado e intentos.
 * - Caché de catálogo por tienda (tenant_slug) para consulta sin conexión.
 * - Migración de la cola heredada almacenada en AsyncStorage (`fashionstore_outbox_*`).
 * - Sobreviene al cierre/reinicio de la app: los datos viven en SQLite, no en memoria.
 *
 * Estados: pendiente → sincronizada | conflicto | rechazada | error
 * La regla de idempotencia la aplica el SERVIDOR (NestJS): misma clave + mismo contenido
 * retorna el resultado original; misma clave + contenido distinto se rechaza.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

export type OutboxEstado = 'pendiente' | 'sincronizada' | 'conflicto' | 'rechazada' | 'error';

export interface OutboxItem {
  id: string;
  tenant_slug: string;
  actor: string | null;
  tipo: 'venta' | 'reserva';
  payload: any;
  payload_hash: string;
  estado: OutboxEstado;
  intentos: number;
  detalle_error: string | null;
  proximo_intento_en?: string | null;
  creado_en: string;
  actualizado_en: string;
}

const DB_NAME = 'fashionstore_offline.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  const db = await dbPromise;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      tenant_slug TEXT NOT NULL,
      actor TEXT,
      tipo TEXT NOT NULL CHECK (tipo IN ('venta', 'reserva')),
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'sincronizada', 'conflicto', 'rechazada', 'error')),
      intentos INTEGER NOT NULL DEFAULT 0,
      detalle_error TEXT,
      proximo_intento_en TEXT,
      creado_en TEXT NOT NULL,
      actualizado_en TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_tenant_estado ON outbox (tenant_slug, estado);
    CREATE TABLE IF NOT EXISTS catalog_cache (
      tenant_slug TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      cursor INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const outboxColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(outbox)');
  if (!outboxColumns.some((column) => column.name === 'proximo_intento_en')) {
    await db.execAsync('ALTER TABLE outbox ADD COLUMN proximo_intento_en TEXT;');
  }
  return db;
}

const FACTORY_GENERATION_KEY = 'factory_generation';

export async function getFactoryGeneration(): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM kv_meta WHERE key = ?',
    [FACTORY_GENERATION_KEY],
  );
  return row?.value ?? null;
}

export async function setFactoryGeneration(generation: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO kv_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [FACTORY_GENERATION_KEY, generation],
  );
}

export async function clearFactoryOfflineState(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM outbox; DELETE FROM catalog_cache; DELETE FROM kv_meta;');
}

export function canonicalizeJson(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return (
    '{' +
    keys
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(value[k])}`)
      .join(',') +
    '}'
  );
}

export async function sha256Hex(text: string): Promise<string> {
  try {
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
  } catch {
    // Fallback no criptográfico solo para entornos sin expo-crypto (no usar en prod)
    let h1 = 0xdeadbeef ^ text.length;
    let h2 = 0x41c6ce57 ^ text.length;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    return (
      (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
    );
  }
}

export async function calcularPayloadHash(payload: any): Promise<string> {
  return sha256Hex(canonicalizeJson(payload));
}

function generarIdOffline(_tipo: 'venta' | 'reserva'): string {
  return Crypto.randomUUID();
}

export async function enqueueOutbox(
  tenantSlug: string,
  tipo: 'venta' | 'reserva',
  payload: any,
  actor?: string | null,
): Promise<OutboxItem> {
  const db = await getDb();
  const id = generarIdOffline(tipo);
  const canonic = {
    ...payload,
    operacion_offline_id: id,
  };
  const payload_hash = await calcularPayloadHash({
    sucursal_id: canonic.sucursal_id,
    metodo_pago: canonic.metodo_pago,
    promocion_codigo: canonic.promocion_codigo ?? null,
    items: (canonic.items || []).map((i: any) => ({
      variante_id: Number(i.variante_id),
      cantidad: Number(i.cantidad),
    })),
  });
  const ahora = new Date().toISOString();
  const item: OutboxItem = {
    id,
    tenant_slug: tenantSlug,
    actor: actor ?? null,
    tipo,
    payload: canonic,
    payload_hash,
    estado: 'pendiente',
    intentos: 0,
    detalle_error: null,
    creado_en: ahora,
    actualizado_en: ahora,
  };
  await db.runAsync(
    `INSERT INTO outbox (id, tenant_slug, actor, tipo, payload_json, payload_hash, estado, intentos, detalle_error, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, 'pendiente', 0, NULL, ?, ?)`,
    [id, tenantSlug, actor ?? null, tipo, JSON.stringify(canonic), payload_hash, ahora, ahora],
  );
  return item;
}

function rowToItem(r: any): OutboxItem {
  return {
    ...r,
    payload: JSON.parse(r.payload_json),
    intentos: Number(r.intentos),
  };
}

export async function listOutbox(tenantSlug: string): Promise<OutboxItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM outbox WHERE tenant_slug = ? ORDER BY creado_en DESC',
    [tenantSlug],
  );
  return rows.map(rowToItem);
}

export async function countPendientes(tenantSlug: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox WHERE tenant_slug = ? AND estado = 'pendiente'",
    [tenantSlug],
  );
  return Number(row?.n ?? 0);
}

export async function updateOutboxState(
  id: string,
  estado: OutboxEstado,
  detalle_error?: string | null,
  options: { incrementarIntento?: boolean; proximo_intento_en?: string | null } = {},
): Promise<void> {
  const db = await getDb();
  const current = await db.getFirstAsync<{ proximo_intento_en: string | null }>(
    'SELECT proximo_intento_en FROM outbox WHERE id = ?',
    [id],
  );
  const nextAttempt = options.proximo_intento_en !== undefined
    ? options.proximo_intento_en
    : estado === 'pendiente'
      ? current?.proximo_intento_en ?? null
      : null;
  await db.runAsync(
    `UPDATE outbox
        SET estado = ?, detalle_error = ?, actualizado_en = ?,
            intentos = intentos + ?, proximo_intento_en = ?
      WHERE id = ?`,
    [estado, detalle_error ?? null, new Date().toISOString(), options.incrementarIntento ? 1 : 0, nextAttempt, id],
  );
}

export async function saveCatalogSnapshot(
  tenantSlug: string,
  snapshot: any,
  cursor = 0,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO catalog_cache (tenant_slug, payload_json, cursor, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tenant_slug) DO UPDATE SET payload_json = excluded.payload_json, cursor = excluded.cursor, updated_at = excluded.updated_at`,
    [tenantSlug, JSON.stringify(snapshot), cursor, new Date().toISOString()],
  );
}

export async function getCatalogSnapshot(tenantSlug: string): Promise<any | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ payload_json: string }>(
    'SELECT payload_json FROM catalog_cache WHERE tenant_slug = ?',
    [tenantSlug],
  );
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    return null;
  }
}

export async function getSyncCursor(tenantSlug: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ cursor: number }>(
    'SELECT cursor FROM catalog_cache WHERE tenant_slug = ?',
    [tenantSlug],
  );
  return Number(row?.cursor ?? 0);
}

/**
 * Migra la cola heredada que vivía en AsyncStorage (AsyncStorage `fashionstore_outbox_<slug>`)
 * hacia SQLite. Idempotente: si ya se migró, no hace nada.
 */
export async function migrateLegacyOutbox(tenantSlug: string): Promise<number> {
  const db = await getDb();
  const migKey = `legacy_outbox_migrated_${tenantSlug}`;
  const migrado = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM kv_meta WHERE key = ?',
    [migKey],
  );
  if (migrado?.value === '1') return 0;

  let insertados = 0;
  try {
    const raw = await AsyncStorage.getItem(`fashionstore_outbox_${tenantSlug}`);
    if (raw) {
      const items = JSON.parse(raw) as Array<any>;
      for (const item of items) {
        const id = String(item?.id || generarIdOffline('venta'));
        const exists = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM outbox WHERE id = ?',
          [id],
        );
        if (exists) continue;
        const ahora = new Date().toISOString();
        await db.runAsync(
          `INSERT INTO outbox (id, tenant_slug, actor, tipo, payload_json, payload_hash, estado, intentos, detalle_error, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
          [
            id,
            tenantSlug,
            item?.actor ?? null,
            item?.tipo === 'reserva' ? 'reserva' : 'venta',
            JSON.stringify(item?.payload ?? {}),
            String(item?.payload_hash || (await calcularPayloadHash(item?.payload ?? {}))),
            item?.estado === 'sincronizada' ? 'sincronizada' : 'pendiente',
            ahora,
            ahora,
          ],
        );
        insertados += 1;
      }
      await AsyncStorage.removeItem(`fashionstore_outbox_${tenantSlug}`);
    }
  } catch {
    // Migración defensiva: nunca romper el arranque por datos heredados corruptos
  }
  await db.runAsync(
    'INSERT INTO kv_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [migKey, '1'],
  );
  return insertados;
}

export interface SyncResult {
  sincronizadas: number;
  conflictos: number;
  rechazadas: number;
  errores: number;
}

/**
 * Sincroniza la cola pendiente contra la API NestJS.
 * `apiFetch` se inyecta para evitar dependencias circulares con src/api.ts.
 */
export async function syncPendingOutbox(
  tenantSlug: string,
  apiFetch: <T = any>(path: string, options?: any) => Promise<T>,
): Promise<SyncResult> {
  const todos = await listOutbox(tenantSlug);
  const ahora = Date.now();
  const pendientes = todos.filter((item) => {
    if (item.estado !== 'pendiente') return false;
    if (!item.proximo_intento_en) return true;
    const proximo = Date.parse(item.proximo_intento_en);
    return !Number.isFinite(proximo) || proximo <= ahora;
  }).sort((a, b) => a.creado_en.localeCompare(b.creado_en));
  const result: SyncResult = { sincronizadas: 0, conflictos: 0, rechazadas: 0, errores: 0 };
  if (pendientes.length === 0) return result;

  const agendarReintento = async (item: OutboxItem, detalle: string): Promise<boolean> => {
    const intentos = Number(item.intentos || 0) + 1;
    const agotado = intentos >= 8;
    const baseMs = Math.min(60 * 60 * 1000, 1000 * 2 ** Math.max(0, intentos - 1));
    const esperaMs = Math.round(baseMs * (0.75 + Math.random() * 0.5));
    await updateOutboxState(item.id, agotado ? 'rechazada' : 'pendiente', detalle, {
      incrementarIntento: true,
      proximo_intento_en: agotado ? null : new Date(Date.now() + esperaMs).toISOString(),
    });
    return agotado;
  };

  let lote: any;
  try {
    lote = await apiFetch('/sync/push', {
      method: 'POST',
      tenantSlug,
      body: {
        operaciones: pendientes.map((item) => ({
          operacion_id: item.id,
          tipo: item.tipo === 'venta' ? 'VENTA_POS' : 'RESERVA',
          payload: item.payload,
          creado_en: item.creado_en,
        })),
      },
    });
  } catch (err: any) {
    const detalle = String(err?.message || 'Error de red al sincronizar.');
    for (const item of pendientes) {
      result.errores += 1;
      if (await agendarReintento(item, detalle)) result.rechazadas += 1;
    }
    return result;
  }

  const resultados: any[] = Array.isArray(lote?.resultados) ? lote.resultados : [];
  const respondidas = new Set<string>();
  for (const row of resultados) {
    const id = String(row?.id || '');
    const item = pendientes.find((candidate) => candidate.id === id);
    if (!item) continue;
    respondidas.add(id);
    if (row.estado === 'sincronizada') {
      result.sincronizadas += 1;
      await updateOutboxState(id, 'sincronizada', null);
    } else if (row.estado === 'conflicto') {
      result.conflictos += 1;
      await updateOutboxState(id, 'conflicto', row.detalle || row.codigo_error || null);
    } else if (row.estado === 'error') {
      result.errores += 1;
      if (await agendarReintento(item, String(row.detalle || row.codigo_error || 'Error temporal del servidor.'))) {
        result.rechazadas += 1;
      }
    } else {
      result.rechazadas += 1;
      await updateOutboxState(id, 'rechazada', row.detalle || row.codigo_error || 'Operación rechazada por el servidor.');
    }
  }

  for (const item of pendientes) {
    if (respondidas.has(item.id)) continue;
    result.errores += 1;
    if (await agendarReintento(item, 'El servidor no devolvió resultado para esta operación.')) {
      result.rechazadas += 1;
    }
  }
  return result;
}
