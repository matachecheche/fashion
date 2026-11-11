import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, apiGetHealth, getAuthToken, setAuthToken } from '../api/client';
import {
  OfflineOutboxItem,
  OfflineQueueStorage,
  resolveTenantSlugFromLocation,
  setActiveTenantSlug,
} from '../lib/format';
import { needsLegacyFactoryNavigation } from '../lib/factoryResetNavigation';

export interface CartItem {
  variante_id: number;
  producto_id: number;
  sku: string;
  nombre: string;
  talla: string;
  color: string;
  precio_unitario: number;
  cantidad: number;
  imagen_url: string;
}

export interface SuscripcionEstado {
  tenant_id: string;
  tenant_slug: string;
  tienda_nombre: string;
  plan_actual: string;
  plan_nombre: string;
  precio_mensual_bob: number;
  estado: string;
  solo_lectura: boolean;
  modo_facturacion: string;
  cobro_real_activo: boolean;
  dias_restantes: number | null;
  cuotas: {
    usuarios: { usado: number; maximo: number; disponible: number; porcentaje: number };
    sucursales: { usado: number; maximo: number; disponible: number; porcentaje: number };
    productos: { usado: number; maximo: number; disponible: number; porcentaje: number };
  };
}

interface AppContextValue {
  tenantSlug: string;
  cambiarTenant: (nuevoSlug: string) => void;
  usuario: any | null;
  iniciarSesion: (token: string, user: any) => void;
  cerrarSesion: () => void;
  suscripcion: SuscripcionEstado | null;
  recargarSuscripcion: () => Promise<void>;
  carrito: CartItem[];
  agregarAlCarrito: (item: CartItem) => void;
  quitarDelCarrito: (varianteId: number) => void;
  limpiarCarrito: () => void;
  sucursalActivaId: number;
  setSucursalActivaId: (id: number) => void;
  online: boolean;
  colaOffline: OfflineOutboxItem[];
  encolarOperacionOffline: (tipo: 'venta' | 'reserva', payload: any) => Promise<OfflineOutboxItem>;
  sincronizarColaOffline: () => Promise<{ sincronizadas: number; conflictos: number; rechazadas: number }>;
  toast: string | null;
  mostrarToast: (msg: string) => void;
  abrirModalOnboarding: boolean;
  setAbrirModalOnboarding: (v: boolean) => void;
  abrirManual: boolean;
  setAbrirManual: (v: boolean) => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);
const FACTORY_GENERATION_KEY = 'fs_factory_generation';

async function clearFactoryPwaApiCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cacheNames = await caches.keys();
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    for (const request of requests) {
      const pathname = new URL(request.url).pathname;
      if (pathname.includes('/catalogo/') || pathname.includes('/sync/pull')) {
        await cache.delete(request);
      }
    }
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const [factoryReady, setFactoryReady] = useState(false);
  const factoryGenerationRef = useRef<string | null>(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(FACTORY_GENERATION_KEY),
  );
  const factoryResetPromiseRef = useRef<Promise<boolean> | null>(null);
  const [tenantSlug, setTenantSlugState] = useState<string>(() => resolveTenantSlugFromLocation());
  const [usuario, setUsuario] = useState<any | null>(() => {
    try {
      const saved = localStorage.getItem(`fs_user_${resolveTenantSlugFromLocation()}`);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [suscripcion, setSuscripcion] = useState<SuscripcionEstado | null>(null);
  const [carrito, setCarrito] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(`fs_cart_${resolveTenantSlugFromLocation()}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [sucursalActivaId, setSucursalActivaId] = useState<number>(1);
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? false : navigator.onLine,
  );
  const [colaOffline, setColaOffline] = useState<OfflineOutboxItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [abrirModalOnboarding, setAbrirModalOnboarding] = useState<boolean>(false);
  const [abrirManual, setAbrirManual] = useState<boolean>(false);
  const syncLockRef = useRef(false);

  const mostrarToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const recargarColaOffline = async (slug = tenantSlug) => {
    const items = await OfflineQueueStorage.list(slug);
    setColaOffline(items);
  };

  const recargarSuscripcion = async (slug = tenantSlug) => {
    try {
      const est = await apiFetch<SuscripcionEstado>('/suscripcion/estado', { tenantSlug: slug });
      setSuscripcion(est);
    } catch {
      // Ignorar si estamos offline
    }
  };

  const synchronizeFactoryGeneration = useCallback(async (generation: string): Promise<boolean> => {
    if (!generation || factoryGenerationRef.current === generation) return false;
    if (factoryResetPromiseRef.current) return factoryResetPromiseRef.current;

    const resetTask = (async () => {
      if (localStorage.getItem(FACTORY_GENERATION_KEY) === generation) {
        factoryGenerationRef.current = generation;
        return false;
      }
      setFactoryReady(false);
      setOnline(false);
      try {
        await OfflineQueueStorage.clearAll().catch(() => undefined);
        await clearFactoryPwaApiCache().catch(() => undefined);
        const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
          (key): key is string => Boolean(key && key.startsWith('fs_')),
        );
        keys.forEach((key) => localStorage.removeItem(key));
        setActiveTenantSlug('legacy');
        localStorage.setItem(FACTORY_GENERATION_KEY, generation);
        factoryGenerationRef.current = generation;
        setTenantSlugState('legacy');
        setUsuario(null);
        setSuscripcion(null);
        setCarrito([]);
        setSucursalActivaId(1);
        setColaOffline([]);
        setAbrirModalOnboarding(false);
        // Panel, rutas de conveniencia y tiendas antiguas deben volver al catálogo sembrado.
        if (needsLegacyFactoryNavigation(window.location.pathname)) {
          navigate('/tienda/legacy', { replace: true });
        }
        return true;
      } finally {
        setFactoryReady(true);
      }
    })();
    factoryResetPromiseRef.current = resetTask;
    try {
      return await resetTask;
    } finally {
      factoryResetPromiseRef.current = null;
    }
  }, [navigate]);

  const cambiarTenant = (nuevoSlug: string) => {
    const clean = String(nuevoSlug || 'legacy').trim().toLowerCase();
    setActiveTenantSlug(clean);
    setTenantSlugState(clean);
    try {
      const savedUser = localStorage.getItem(`fs_user_${clean}`);
      setUsuario(savedUser ? JSON.parse(savedUser) : null);
      const savedCart = localStorage.getItem(`fs_cart_${clean}`);
      setCarrito(savedCart ? JSON.parse(savedCart) : []);
    } catch {
      setUsuario(null);
      setCarrito([]);
    }
    recargarSuscripcion(clean);
    recargarColaOffline(clean);
  };

  useEffect(() => {
    if (!factoryReady) return;
    recargarSuscripcion(tenantSlug);
    recargarColaOffline(tenantSlug);
    const token = getAuthToken(tenantSlug);
    if (token) {
      apiFetch('/auth/me', { tenantSlug, token })
        .then((res) => {
          if (res?.usuario) {
            setUsuario(res.usuario);
            localStorage.setItem(`fs_user_${tenantSlug}`, JSON.stringify(res.usuario));
          }
        })
        .catch((err: any) => {
          if ([401, 403, 404].includes(Number(err?.status))) {
            setAuthToken(null, tenantSlug);
            localStorage.removeItem(`fs_user_${tenantSlug}`);
            setUsuario(null);
          }
        });
    }
  }, [tenantSlug, factoryReady]);

  useEffect(() => {
    let disposed = false;
    let checking = false;
    const refreshConnectivity = async () => {
      if (checking || disposed) return;
      if (!navigator.onLine) {
        setOnline(false);
        setFactoryReady(true);
        return;
      }
      checking = true;
      try {
        const health = await apiGetHealth();
        if (disposed) return;
        if (health?.factory_generation) {
          await synchronizeFactoryGeneration(health.factory_generation);
        }
        if (!disposed) {
          setOnline(health?.estado === 'ok' || health?.status === 'ok');
          setFactoryReady(true);
        }
      } catch {
        if (!disposed) {
          setOnline(false);
          setFactoryReady(true);
        }
      } finally {
        checking = false;
      }
    };
    const onOffline = () => setOnline(false);
    const onOnline = () => void refreshConnectivity();
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    void refreshConnectivity();
    const timer = window.setInterval(() => void refreshConnectivity(), 30000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [synchronizeFactoryGeneration]);

  useEffect(() => {
    if (!factoryReady) return;
    localStorage.setItem(`fs_cart_${tenantSlug}`, JSON.stringify(carrito));
  }, [carrito, tenantSlug, factoryReady]);

  const iniciarSesion = (token: string, user: any) => {
    const effectiveSlug = String(user?.tenant_slug || tenantSlug).trim().toLowerCase();
    setActiveTenantSlug(effectiveSlug);
    setTenantSlugState(effectiveSlug);
    setAuthToken(token, effectiveSlug);
    setUsuario(user);
    localStorage.setItem(`fs_user_${effectiveSlug}`, JSON.stringify(user));
    recargarSuscripcion(effectiveSlug);
  };

  const cerrarSesion = () => {
    setAuthToken(null, tenantSlug);
    setUsuario(null);
    localStorage.removeItem(`fs_user_${tenantSlug}`);
    mostrarToast('Sesion cerrada correctamente.');
  };

  const agregarAlCarrito = (nuevo: CartItem) => {
    setCarrito((prev) => {
      const existe = prev.find((i) => i.variante_id === nuevo.variante_id);
      if (existe) {
        return prev.map((i) =>
          i.variante_id === nuevo.variante_id
            ? { ...i, cantidad: i.cantidad + nuevo.cantidad }
            : i,
        );
      }
      return [...prev, nuevo];
    });
    mostrarToast(`Agregado al carrito: ${nuevo.nombre} (${nuevo.talla} / ${nuevo.color})`);
  };

  const quitarDelCarrito = (varianteId: number) => {
    setCarrito((prev) => prev.filter((i) => i.variante_id !== varianteId));
  };

  const limpiarCarrito = () => {
    setCarrito([]);
  };

  const encolarOperacionOffline = async (tipo: 'venta' | 'reserva', payload: any) => {
    const item = await OfflineQueueStorage.enqueue(tenantSlug, tipo, payload);
    await recargarColaOffline(tenantSlug);
    mostrarToast(`Operacion ${item.id} guardada en cola offline (IndexedDB).`);
    return item;
  };

  const sincronizarColaOffline = async (silencioso = false) => {
    if (syncLockRef.current) return { sincronizadas: 0, conflictos: 0, rechazadas: 0 };
    if (typeof navigator === 'undefined' || !navigator.onLine || !online) {
      if (!silencioso) mostrarToast('Sin conexión con el servidor. Las operaciones siguen guardadas en este dispositivo.');
      return { sincronizadas: 0, conflictos: 0, rechazadas: 0 };
    }

    syncLockRef.current = true;
    try {
      const actuales = await OfflineQueueStorage.list(tenantSlug);
      const ahora = Date.now();
      const pendientes = actuales.filter((x) =>
        x.estado === 'pendiente' &&
        (!x.proximo_intento_en || Date.parse(x.proximo_intento_en) <= ahora),
      );
      if (pendientes.length === 0) {
        if (!silencioso && actuales.some((x) => x.estado === 'pendiente')) {
          mostrarToast('Hay operaciones pendientes; se reintentará al vencer el backoff.');
        } else if (!silencioso) {
          mostrarToast('No hay operaciones pendientes por sincronizar.');
        }
        return { sincronizadas: 0, conflictos: 0, rechazadas: 0 };
      }

      const reintentar = async (item: OfflineOutboxItem, detalle: string): Promise<boolean> => {
        const intentos = Number(item.intentos || 0) + 1;
        const agotado = intentos >= 8;
        const baseMs = Math.min(60 * 60 * 1000, 1000 * 2 ** Math.max(0, intentos - 1));
        const esperaMs = Math.round(baseMs * (0.75 + Math.random() * 0.5));
        await OfflineQueueStorage.updateStatus(
          tenantSlug,
          item.id,
          agotado ? 'rechazada' : 'pendiente',
          detalle,
          {
            incrementarIntento: true,
            proximo_intento_en: agotado ? null : new Date(Date.now() + esperaMs).toISOString(),
          },
        );
        return agotado;
      };

      let loteRes: any;
      try {
        loteRes = await apiFetch('/sync/push', {
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
        let rechazadasPorReintentos = 0;
        for (const item of pendientes) {
          if (await reintentar(item, detalle)) rechazadasPorReintentos++;
        }
        await recargarColaOffline(tenantSlug);
        if (!silencioso) mostrarToast(`No se pudo sincronizar. Reintento programado; ${rechazadasPorReintentos} operación(es) agotaron 8 intentos.`);
        return { sincronizadas: 0, conflictos: 0, rechazadas: rechazadasPorReintentos };
      }

      let sincronizadas = 0;
      let conflictos = 0;
      let rechazadas = 0;
      for (const resultado of loteRes?.resultados || []) {
        const id = String(resultado?.id || '');
        const item = pendientes.find((x) => x.id === id);
        if (resultado?.estado === 'sincronizada') {
          await OfflineQueueStorage.updateStatus(tenantSlug, id, 'sincronizada', resultado.detalle);
          sincronizadas++;
        } else if (resultado?.estado === 'conflicto') {
          await OfflineQueueStorage.updateStatus(tenantSlug, id, 'conflicto', resultado.detalle || resultado.codigo_error);
          conflictos++;
        } else if (resultado?.estado === 'error' && item) {
          if (await reintentar(item, String(resultado.detalle || resultado.codigo_error || 'Error temporal del servidor.'))) {
            rechazadas++;
          }
        } else if (resultado?.estado === 'rechazada') {
          await OfflineQueueStorage.updateStatus(tenantSlug, id, 'rechazada', resultado.detalle || resultado.codigo_error);
          rechazadas++;
        }
      }

      await recargarColaOffline(tenantSlug);
      if (!silencioso) {
        mostrarToast(`Sincronización completada: ${sincronizadas} aplicadas, ${conflictos} conflictos, ${rechazadas} rechazadas.`);
      }
      return { sincronizadas, conflictos, rechazadas };
    } finally {
      syncLockRef.current = false;
    }
  };

  useEffect(() => {
    if (!online) return;
    const retryTimer = window.setInterval(() => void sincronizarColaOffline(true), 15000);
    return () => window.clearInterval(retryTimer);
  }, [online, tenantSlug]);

  if (!factoryReady) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
        Preparando FashionStore y verificando los datos de fábrica…
      </main>
    );
  }

  return (
    <AppContext.Provider
      value={{
        tenantSlug,
        cambiarTenant,
        usuario,
        iniciarSesion,
        cerrarSesion,
        suscripcion,
        recargarSuscripcion: () => recargarSuscripcion(tenantSlug),
        carrito,
        agregarAlCarrito,
        quitarDelCarrito,
        limpiarCarrito,
        sucursalActivaId,
        setSucursalActivaId,
        online,
        colaOffline,
        encolarOperacionOffline,
        sincronizarColaOffline,
        toast,
        mostrarToast,
        abrirModalOnboarding,
        setAbrirModalOnboarding,
        abrirManual,
        setAbrirManual,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp debe usarse dentro de AppProvider');
  return ctx;
}
