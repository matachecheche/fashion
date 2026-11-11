/**
 * Utilidades de formato, resolucion de Tenant y Cola Durable Offline en IndexedDB (PWA)
 */

export function formatBs(valor: number | string | null | undefined): string {
  const num = Number(valor ?? 0);
  if (Number.isNaN(num)) return 'Bs. 0.00';
  return `Bs. ${num.toFixed(2)}`;
}

export function formatFecha(fecha?: string | Date | null): string {
  if (!fecha) return '-';
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha;
  if (Number.isNaN(d.getTime())) return String(fecha);
  return d.toLocaleString('es-BO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function resolveTenantSlugFromLocation(pathname?: string): string {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  const match = /^\/tienda\/([a-z0-9-]+)(\/.*)?$/i.exec(path);
  if (match && match[1]) {
    const slug = match[1].toLowerCase();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('fs_active_tenant_slug', slug);
    }
    return slug;
  }
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('fs_active_tenant_slug');
    if (saved && /^[a-z0-9-]+$/.test(saved)) return saved;
  }
  return import.meta.env.VITE_DEFAULT_TENANT_SLUG || 'legacy';
}

export function setActiveTenantSlug(slug: string): void {
  const clean = String(slug || 'legacy').trim().toLowerCase();
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('fs_active_tenant_slug', clean);
  }
}

export function buildAssetUrl(url?: string | null): string {
  if (!url) return '/assets/prendas/vestido-rojo-foto.jpg';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '');
  return `${apiBase}${url.startsWith('/') ? '' : '/'}${url}`;
}

export function canonicalizeJson(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalizeJson).join(',') + ']';
  }
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

export async function sha256HexBrowser(payload: any): Promise<string> {
  const text = typeof payload === 'string' ? payload : canonicalizeJson(payload);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback determinista para entornos sin SubtleCrypto
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export interface OfflineOutboxItem {
  id: string;
  tenant_slug: string;
  tipo: 'venta' | 'reserva';
  payload: any;
  payload_hash: string;
  estado: 'pendiente' | 'sincronizada' | 'conflicto' | 'rechazada' | 'error';
  detalle_error?: string;
  intentos?: number;
  proximo_intento_en?: string | null;
  creado_en: string;
}

const IDB_NAME = 'fashionstore_pwa_offline_db';
const IDB_VERSION = 2;

export function createUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function openOfflineDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('outbox')) {
        const store = db.createObjectStore('outbox', { keyPath: 'id' });
        store.createIndex('by_tenant', 'tenant_slug', { unique: false });
      }
      if (!db.objectStoreNames.contains('catalog_cache')) {
        db.createObjectStore('catalog_cache', { keyPath: 'tenant_slug' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export const OfflineQueueStorage = {
  async enqueue(
    tenantSlug: string,
    tipo: 'venta' | 'reserva',
    payload: any,
    customId?: string,
  ): Promise<OfflineOutboxItem> {
    const id = customId || createUuidV4();
    const payload_hash = await sha256HexBrowser(payload);
    const item: OfflineOutboxItem = {
      id,
      tenant_slug: tenantSlug,
      tipo,
      payload: { ...payload, operacion_offline_id: id },
      payload_hash,
      estado: 'pendiente',
      detalle_error: undefined,
      intentos: 0,
      proximo_intento_en: null,
      creado_en: new Date().toISOString(),
    };

    const db = await openOfflineDb();
    if (db) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction('outbox', 'readwrite');
        tx.objectStore('outbox').put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } else if (typeof localStorage !== 'undefined') {
      const list = await this.list(tenantSlug);
      const next = [...list.filter((x) => x.id !== id), item];
      localStorage.setItem(`fs_outbox_${tenantSlug}`, JSON.stringify(next));
    }
    return item;
  },

  async list(tenantSlug: string): Promise<OfflineOutboxItem[]> {
    const db = await openOfflineDb();
    if (db) {
      return new Promise((resolve) => {
        const tx = db.transaction('outbox', 'readonly');
        const req = tx.objectStore('outbox').getAll();
        req.onsuccess = () => {
          const all = (req.result || []) as OfflineOutboxItem[];
          resolve(all.filter((x) => x.tenant_slug === tenantSlug));
        };
        req.onerror = () => resolve([]);
      });
    }
    if (typeof localStorage !== 'undefined') {
      try {
        return JSON.parse(localStorage.getItem(`fs_outbox_${tenantSlug}`) || '[]');
      } catch {
        return [];
      }
    }
    return [];
  },

  async updateStatus(
    tenantSlug: string,
    id: string,
    estado: OfflineOutboxItem['estado'],
    detalle_error?: string,
    options: { incrementarIntento?: boolean; proximo_intento_en?: string | null } = {},
  ): Promise<void> {
    const patch = (item: OfflineOutboxItem): OfflineOutboxItem => {
      const updated: OfflineOutboxItem = {
        ...item,
        estado,
        detalle_error,
        intentos: Math.max(0, Number(item.intentos || 0) + (options.incrementarIntento ? 1 : 0)),
      };
      if (options.proximo_intento_en !== undefined) {
        updated.proximo_intento_en = options.proximo_intento_en;
      } else if (estado !== 'pendiente') {
        updated.proximo_intento_en = null;
      }
      return updated;
    };
    const db = await openOfflineDb();
    if (db) {
      const all = await this.list(tenantSlug);
      const target = all.find((x) => x.id === id);
      if (target) {
        await new Promise<void>((resolve) => {
          const tx = db.transaction('outbox', 'readwrite');
          tx.objectStore('outbox').put(patch(target));
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      }
      return;
    }
    if (typeof localStorage !== 'undefined') {
      const list = await this.list(tenantSlug);
      localStorage.setItem(
        `fs_outbox_${tenantSlug}`,
        JSON.stringify(list.map((item) => item.id === id ? patch(item) : item)),
      );
    }
  },

  async saveCatalogSnapshot(tenantSlug: string, data: any): Promise<void> {
    const db = await openOfflineDb();
    if (db) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction('catalog_cache', 'readwrite');
        tx.objectStore('catalog_cache').put({
          tenant_slug: tenantSlug,
          updated_at: new Date().toISOString(),
          data,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  },

  async getCatalogSnapshot(tenantSlug: string): Promise<any | null> {
    const db = await openOfflineDb();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction('catalog_cache', 'readonly');
      const req = tx.objectStore('catalog_cache').get(tenantSlug);
      req.onsuccess = () => resolve(req.result?.data || null);
      req.onerror = () => resolve(null);
    });
  },

  async clearAll(): Promise<void> {
    const db = await openOfflineDb();
    if (db) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(['outbox', 'catalog_cache'], 'readwrite');
        tx.objectStore('outbox').clear();
        tx.objectStore('catalog_cache').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
      db.close();
      return;
    }
    if (typeof localStorage !== 'undefined') {
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
        (key): key is string => Boolean(key && key.startsWith('fs_outbox_')),
      );
      keys.forEach((key) => localStorage.removeItem(key));
    }
  },
};
