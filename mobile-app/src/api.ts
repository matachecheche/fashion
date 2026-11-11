/**
 * Cliente HTTP móvil con tenant canónico (path slug /tienda/{slug} en web; acá, header
 * X-Tenant-Slug firmado con el mismo tenant del JWT). Nunca se envía tenant_id libre:
 * el servidor valida que el slug coincida con el tenant del token.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { API_BASE, DEFAULT_TENANT_SLUG } from './config';

const KEY_TENANT = 'fs_mobile_tenant_slug';
const KEY_TOKEN_PREFIX = 'fs_mobile_token_';
const KEY_TOKEN_SLUGS = 'fs_mobile_token_slugs';

export interface ApiHealth {
  estado?: string;
  status?: string;
  schema_version?: number;
  factory_generation?: string | null;
}

export async function apiGetHealth(): Promise<ApiHealth | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${API_BASE}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as ApiHealth;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getTenantSlug(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(KEY_TENANT);
    return saved && /^[a-z0-9-]+$/.test(saved) ? saved : DEFAULT_TENANT_SLUG;
  } catch {
    return DEFAULT_TENANT_SLUG;
  }
}

export async function setTenantSlug(slug: string): Promise<void> {
  const clean = String(slug || DEFAULT_TENANT_SLUG).trim().toLowerCase();
  await AsyncStorage.setItem(KEY_TENANT, clean);
}

export async function getAuthToken(tenantSlug?: string): Promise<string | null> {
  const slug = tenantSlug || (await getTenantSlug());
  try {
    return await SecureStore.getItemAsync(`${KEY_TOKEN_PREFIX}${slug}`);
  } catch {
    return null;
  }
}

export async function setAuthToken(token: string | null, tenantSlug?: string): Promise<void> {
  const slug = tenantSlug || (await getTenantSlug());
  try {
    if (token) {
      await SecureStore.setItemAsync(`${KEY_TOKEN_PREFIX}${slug}`, token);
      const raw = await AsyncStorage.getItem(KEY_TOKEN_SLUGS);
      const slugs = raw ? JSON.parse(raw) as string[] : [];
      await AsyncStorage.setItem(KEY_TOKEN_SLUGS, JSON.stringify(Array.from(new Set([...slugs, slug]))));
    } else {
      await SecureStore.deleteItemAsync(`${KEY_TOKEN_PREFIX}${slug}`);
      const raw = await AsyncStorage.getItem(KEY_TOKEN_SLUGS);
      const slugs = raw ? JSON.parse(raw) as string[] : [];
      await AsyncStorage.setItem(KEY_TOKEN_SLUGS, JSON.stringify(slugs.filter((item) => item !== slug)));
    }
  } catch {
    // SecureStore no disponible (web): el token simplemente no se persiste
  }
}

export async function clearFactoryAuthTokens(knownSlugs: string[]): Promise<void> {
  let indexedSlugs: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(KEY_TOKEN_SLUGS);
    indexedSlugs = raw ? JSON.parse(raw) as string[] : [];
  } catch {
    indexedSlugs = [];
  }
  const slugs = Array.from(new Set([...knownSlugs, ...indexedSlugs, DEFAULT_TENANT_SLUG]));
  await Promise.all(slugs.map((slug) =>
    SecureStore.deleteItemAsync(`${KEY_TOKEN_PREFIX}${slug}`).catch(() => undefined),
  ));
  await AsyncStorage.removeItem(KEY_TOKEN_SLUGS).catch(() => undefined);
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  tenantSlug?: string;
  rawResponse?: boolean;
  headers?: Record<string, string>;
}

export async function apiFetch<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const tenantSlug = options.tenantSlug || (await getTenantSlug());
  const token = await getAuthToken(tenantSlug);
  const method = options.method || 'GET';

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Tenant-Slug': tenantSlug,
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined && options.body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  const normalized = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(`${API_BASE}${normalized}`, {
    method,
    headers,
    body: options.body !== undefined && options.body !== null ? JSON.stringify(options.body) : undefined,
  });

  if (options.rawResponse) return res as unknown as T;

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
      `Error HTTP ${res.status} en ${normalized}`;
    const err: any = new Error(Array.isArray(message) ? message.join(', ') : String(message));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

/** Sincroniza el cursor incremental del catálogo y cachea el snapshot en SQLite. */
export async function pullCatalogSuite(tenantSlug: string): Promise<any> {
  const { saveCatalogSnapshot, getSyncCursor } = await import('./offline');
  const cursor = await getSyncCursor(tenantSlug);
  const res = await apiFetch(`/sync/pull?cursor=${cursor}&limit=100`, { tenantSlug });
  if (res && typeof res.next_cursor === 'number' && res.snapshot) {
    await saveCatalogSnapshot(tenantSlug, res.snapshot, res.next_cursor);
  } else if (res?.snapshot) {
    await saveCatalogSnapshot(tenantSlug, res.snapshot, cursor);
  }
  return res;
}
