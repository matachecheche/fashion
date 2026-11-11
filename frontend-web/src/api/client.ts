/**
 * Cliente HTTP Multi-Tenant con soporte Offline-First e Idempotencia
 */
import { OfflineQueueStorage, resolveTenantSlugFromLocation } from '../lib/format';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

export interface ApiHealth {
  estado?: string;
  status?: string;
  schema_version?: number;
  factory_generation?: string | null;
}

export async function apiGetHealth(): Promise<ApiHealth | null> {
  try {
    const response = await fetch(`${API_BASE}/health`, {
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) return null;
    return (await response.json()) as ApiHealth;
  } catch {
    return null;
  }
}

export async function apiIsHealthy(): Promise<boolean> {
  const body = await apiGetHealth();
  return body?.estado === 'ok' || body?.status === 'ok';
}

export function getAuthToken(tenantSlug?: string): string | null {
  const slug = tenantSlug || resolveTenantSlugFromLocation();
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(`fs_token_${slug}`) || localStorage.getItem('fs_token');
}

export function setAuthToken(token: string | null, tenantSlug?: string): void {
  const slug = tenantSlug || resolveTenantSlugFromLocation();
  if (typeof localStorage === 'undefined') return;
  if (token) {
    localStorage.setItem(`fs_token_${slug}`, token);
    localStorage.setItem('fs_token', token);
  } else {
    localStorage.removeItem(`fs_token_${slug}`);
    localStorage.removeItem('fs_token');
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  tenantSlug?: string;
  token?: string | null;
  rawResponse?: boolean;
  headers?: Record<string, string>;
}

export async function apiFetch<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const tenantSlug = options.tenantSlug || resolveTenantSlugFromLocation();
  const token = options.token !== undefined ? options.token : getAuthToken(tenantSlug);
  const method = options.method || 'GET';

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Tenant-Slug': tenantSlug,
    ...(options.headers || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options.body !== undefined && options.body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${API_BASE}${normalizedPath}`;

  const res = await fetch(url, {
    method,
    headers,
    body: options.body !== undefined && options.body !== null ? JSON.stringify(options.body) : undefined,
  });

  if (options.rawResponse) {
    return res as unknown as T;
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      (data && (data.message || data.detail || data.error)) ||
      `Error HTTP ${res.status} al invocar ${normalizedPath}`;
    const err: any = new Error(Array.isArray(message) ? message.join(', ') : String(message));
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data as T;
}

export async function descargarReporteBinario(
  comando: string,
  formato: 'pdf' | 'excel' | 'csv',
  tenantSlug?: string,
): Promise<void> {
  const slug = tenantSlug || resolveTenantSlugFromLocation();
  const token = getAuthToken(slug);
  const res = await fetch(`${API_BASE}/reportes/ia/exportar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': slug,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ comando, formato }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`No se pudo exportar el reporte (${res.status}): ${errText}`);
  }

  const blob = await res.blob();
  const ext = formato === 'excel' ? 'xlsx' : formato;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reporte-${slug}-${Date.now()}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function pullCatalogIncremental(tenantSlug?: string): Promise<any> {
  const slug = tenantSlug || resolveTenantSlugFromLocation();
  const cursorKey = `fs_sync_cursor_${slug}`;
  const cursor = typeof localStorage !== 'undefined' ? Number(localStorage.getItem(cursorKey) || 0) : 0;
  try {
    const res = await apiFetch(`/sync/pull?cursor=${cursor}&limit=100`, { tenantSlug: slug });
    if (res && typeof res.next_cursor === 'number' && typeof localStorage !== 'undefined') {
      localStorage.setItem(cursorKey, String(res.next_cursor));
    }
    if (res?.snapshot) {
      await OfflineQueueStorage.saveCatalogSnapshot(slug, res.snapshot);
    }
    return res;
  } catch {
    const cached = await OfflineQueueStorage.getCatalogSnapshot(slug);
    return { offline: true, snapshot: cached, cambios: [] };
  }
}
