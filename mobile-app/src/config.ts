/**
 * Configuración runtime de la app móvil FashionStore.
 * EXPO_PUBLIC_API_URL es una variable pública (no secreta) incrustada en el bundle.
 * Los secretos reales (JWT_SECRET, IA_INTERNAL_KEY, DATABASE_URL) NUNCA van en la app.
 */

export const API_BASE: string =
  (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000/api').replace(/\/+$/, '');

export const DEFAULT_TENANT_SLUG: string = (
  process.env.EXPO_PUBLIC_DEFAULT_TENANT_SLUG || 'legacy'
).toLowerCase();

export const APP_NAME = 'FashionStore';
export const APP_VERSION = '2.1.0';

export function apiAssetUrl(pathOrUrl?: string | null): string {
  if (!pathOrUrl) return `${API_BASE.replace(/\/api$/, '')}/assets/prendas/vestido-rojo-foto.jpg`;
  if (/^https?:\/\//.test(pathOrUrl) || pathOrUrl.startsWith('data:')) return pathOrUrl;
  const base = API_BASE.replace(/\/api$/, '');
  return `${base}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}
