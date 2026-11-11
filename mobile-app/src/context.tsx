/**
 * Estado global de la app: tenant, usuario, carrito, cola offline y sincronización.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import { AppState } from 'react-native';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiFetch, apiGetHealth, clearFactoryAuthTokens, getTenantSlug, setAuthToken, setTenantSlug } from './api';
import { DEFAULT_TENANT_SLUG } from './config';
import {
  clearFactoryOfflineState,
  countPendientes,
  getFactoryGeneration,
  OutboxItem,
  enqueueOutbox,
  listOutbox,
  migrateLegacyOutbox,
  setFactoryGeneration,
  syncPendingOutbox,
} from './offline';

export interface CartItem {
  variante_id: number;
  producto_id: number;
  sku: string;
  nombre: string;
  talla: string;
  color: string;
  precio_unitario: number;
  cantidad: number;
  imagen_url?: string | null;
}

interface AppContextValue {
  tenantSlug: string;
  cambiarTenant: (slug: string) => Promise<void>;
  usuario: any | null;
  iniciarSesion: (token: string, user: any) => Promise<void>;
  cerrarSesion: () => Promise<void>;
  carrito: CartItem[];
  agregarAlCarrito: (item: CartItem) => void;
  quitarDelCarrito: (varianteId: number) => void;
  limpiarCarrito: () => void;
  cola: OutboxItem[];
  pendientes: number;
  online: boolean;
  encolarVenta: (payload: any) => Promise<any>;
  encolarReserva: (payload: any) => Promise<any>;
  sincronizar: () => Promise<{ sincronizadas: number; conflictos: number; rechazadas: number; errores: number }>;
  refrescar: () => Promise<void>;
  toast: string | null;
  mostrarToast: (msg: string) => void;
  onboardingVisto: boolean;
  marcarOnboardingVisto: () => Promise<void>;
  cargandoSesion: boolean;
  factoryResetVersion: number;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const cartKey = (slug: string) => `fs_mobile_cart_${slug}`;
const userKey = (slug: string) => `fs_mobile_user_${slug}`;
const onboardingKey = (slug: string) => `fs_mobile_onboarding_${slug}`;

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenantSlug, setTenantSlugState] = useState('legacy');
  const [usuario, setUsuario] = useState<any | null>(null);
  const [carrito, setCarrito] = useState<CartItem[]>([]);
  const [cola, setCola] = useState<OutboxItem[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [online, setOnline] = useState(false);
  const syncLockRef = useRef(false);
  const [toast, setToast] = useState<string | null>(null);
  const [onboardingVisto, setOnboardingVisto] = useState(true);
  const [cargandoSesion, setCargandoSesion] = useState(true);
  const [factoryResetVersion, setFactoryResetVersion] = useState(0);
  const factoryGenerationRef = useRef<string | null>(null);
  const factoryResetPromiseRef = useRef<Promise<boolean> | null>(null);

  const mostrarToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((prev) => (prev === msg ? null : prev)), 4000);
  }, []);

  const synchronizeFactoryGeneration = useCallback(async (
    generation: string,
    activeSlug: string,
  ): Promise<boolean> => {
    if (!generation || factoryGenerationRef.current === generation) return false;
    if (factoryResetPromiseRef.current) return factoryResetPromiseRef.current;

    const resetTask = (async () => {
      try {
        const storedGeneration = await getFactoryGeneration();
        factoryGenerationRef.current = storedGeneration;
        if (storedGeneration === generation) {
          factoryGenerationRef.current = generation;
          return false;
        }

        setCargandoSesion(true);
        setOnline(false);
        const keys = await AsyncStorage.getAllKeys();
        const slugsFromStorage = keys.flatMap((key) => {
          const match = /^fs_mobile_(?:cart|user|onboarding)_([a-z0-9-]+)$/i.exec(key);
          return match?.[1] ? [match[1]] : [];
        });
        await clearFactoryAuthTokens([activeSlug, ...slugsFromStorage]);
        await clearFactoryOfflineState();
        const keysToClear = keys.filter((key) =>
          (key.startsWith('fs_mobile_') && !key.startsWith('fs_mobile_onboarding_')) ||
          key.startsWith('fashionstore_outbox_'),
        );
        if (keysToClear.length) await AsyncStorage.multiRemove(keysToClear);
        await setTenantSlug(DEFAULT_TENANT_SLUG);
        await AsyncStorage.setItem(onboardingKey(DEFAULT_TENANT_SLUG), '1');
        await setFactoryGeneration(generation);
        factoryGenerationRef.current = generation;

        setTenantSlugState(DEFAULT_TENANT_SLUG);
        setUsuario(null);
        setCarrito([]);
        setCola([]);
        setPendientes(0);
        setOnboardingVisto(true);
        setFactoryResetVersion((version) => version + 1);
        return true;
      } catch (error) {
        setCargandoSesion(false);
        throw error;
      }
    })();
    factoryResetPromiseRef.current = resetTask;
    try {
      return await resetTask;
    } finally {
      factoryResetPromiseRef.current = null;
    }
  }, []);

  const refrescar = useCallback(async () => {
    let slug = await getTenantSlug();
    setTenantSlugState(slug);
    try {
      const health = await apiGetHealth();
      if (health?.factory_generation) {
        const reset = await synchronizeFactoryGeneration(health.factory_generation, slug);
        if (reset) slug = DEFAULT_TENANT_SLUG;
      }
    } catch {
      // Si la API está fuera de línea, conserva el modo offline hasta reconectar.
    }
    setTenantSlugState(slug);
    try {
      const [cartRaw, userRaw, obRaw] = await Promise.all([
        AsyncStorage.getItem(cartKey(slug)),
        AsyncStorage.getItem(userKey(slug)),
        AsyncStorage.getItem(onboardingKey(slug)),
      ]);
      setCarrito(cartRaw ? JSON.parse(cartRaw) : []);
      setUsuario(userRaw ? JSON.parse(userRaw) : null);
      setOnboardingVisto(obRaw === '1');
    } catch {
      setCarrito([]);
      setUsuario(null);
    }
    await migrateLegacyOutbox(slug);
    try {
      setCola(await listOutbox(slug));
      setPendientes(await countPendientes(slug));
    } catch {
      setCola([]);
      setPendientes(0);
    }
    setCargandoSesion(false);
  }, [synchronizeFactoryGeneration]);

  useEffect(() => {
    refrescar();
  }, [refrescar]);

  useEffect(() => {
    let active = true;
    let checking = false;
    const refreshConnectivity = async () => {
      if (checking || !active) return;
      checking = true;
      try {
        const state = await Network.getNetworkStateAsync();
        if (!state.isConnected || state.isInternetReachable === false) {
          if (active) setOnline(false);
          return;
        }
        const health = await apiGetHealth();
        if (health?.factory_generation) {
          const activeSlug = await getTenantSlug();
          const reset = await synchronizeFactoryGeneration(health.factory_generation, activeSlug);
          if (reset && !cargandoSesion) await refrescar();
        }
        if (active) setOnline(health?.estado === 'ok' || health?.status === 'ok');
      } catch {
        if (active) setOnline(false);
        if (!cargandoSesion) setCargandoSesion(false);
      } finally {
        checking = false;
      }
    };
    void refreshConnectivity();
    const interval = setInterval(() => void refreshConnectivity(), 30000);
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshConnectivity();
    });
    return () => {
      active = false;
      clearInterval(interval);
      appStateSub.remove();
    };
  }, [tenantSlug, synchronizeFactoryGeneration, cargandoSesion, refrescar]);

  useEffect(() => {
    AsyncStorage.setItem(cartKey(tenantSlug), JSON.stringify(carrito)).catch(() => undefined);
  }, [carrito, tenantSlug]);

  const cambiarTenant = useCallback(
    async (slug: string) => {
      const clean = String(slug || 'legacy').trim().toLowerCase();
      await setTenantSlug(clean);
      await refrescar();
      mostrarToast(`Tienda activa: /tienda/${clean}`);
    },
    [refrescar, mostrarToast],
  );

  const iniciarSesion = useCallback(
    async (token: string, user: any) => {
      const effectiveSlug = String(user?.tenant_slug || tenantSlug).trim().toLowerCase();
      if (effectiveSlug !== tenantSlug) {
        await setTenantSlug(effectiveSlug);
        setTenantSlugState(effectiveSlug);
      }
      await setAuthToken(token, effectiveSlug);
      setUsuario(user);
      await AsyncStorage.setItem(userKey(effectiveSlug), JSON.stringify(user));
      mostrarToast(`Bienvenido/a, ${user?.nombre || 'usuario'}`);
    },
    [tenantSlug, mostrarToast],
  );

  const cerrarSesion = useCallback(async () => {
    await setAuthToken(null, tenantSlug);
    setUsuario(null);
    await AsyncStorage.removeItem(userKey(tenantSlug));
    mostrarToast('Sesión cerrada.');
  }, [tenantSlug, mostrarToast]);

  const agregarAlCarrito = useCallback(
    (item: CartItem) => {
      setCarrito((prev) => {
        const existe = prev.find((i) => i.variante_id === item.variante_id);
        if (existe) {
          return prev.map((i) =>
            i.variante_id === item.variante_id ? { ...i, cantidad: i.cantidad + item.cantidad } : i,
          );
        }
        return [...prev, item];
      });
      mostrarToast(`Agregado: ${item.nombre} (${item.talla}/${item.color})`);
    },
    [mostrarToast],
  );

  const quitarDelCarrito = useCallback((varianteId: number) => {
    setCarrito((prev) => prev.filter((i) => i.variante_id !== varianteId));
  }, []);

  const limpiarCarrito = useCallback(() => setCarrito([]), []);

  const encolarVenta = useCallback(
    async (payload: any) => {
      const item = await enqueueOutbox(tenantSlug, 'venta', payload, usuario?.email ?? null);
      setCola(await listOutbox(tenantSlug));
      setPendientes(await countPendientes(tenantSlug));
      mostrarToast(`Venta ${item.id} encolada (SQLite). Se sincronizará al reconectar.`);
      return item;
    },
    [tenantSlug, usuario, mostrarToast],
  );

  const encolarReserva = useCallback(
    async (payload: any) => {
      const item = await enqueueOutbox(tenantSlug, 'reserva', payload, usuario?.email ?? null);
      setCola(await listOutbox(tenantSlug));
      setPendientes(await countPendientes(tenantSlug));
      mostrarToast(`Reserva ${item.id} encolada (SQLite).`);
      return item;
    },
    [tenantSlug, usuario, mostrarToast],
  );

  const sincronizar = useCallback(async () => {
    if (!online) {
      return { sincronizadas: 0, conflictos: 0, rechazadas: 0, errores: 0 };
    }
    if (syncLockRef.current) {
      return { sincronizadas: 0, conflictos: 0, rechazadas: 0, errores: 0 };
    }
    syncLockRef.current = true;
    try {
      const res = await syncPendingOutbox(tenantSlug, apiFetch);
      setCola(await listOutbox(tenantSlug));
      setPendientes(await countPendientes(tenantSlug));
      mostrarToast(
        `Sync: ${res.sincronizadas} ok · ${res.conflictos} conflicto · ${res.rechazadas} rechazada · ${res.errores} error`,
      );
      return res;
    } finally {
      syncLockRef.current = false;
    }
  }, [tenantSlug, online, mostrarToast]);

  useEffect(() => {
    if (online && !cargandoSesion && pendientes > 0) {
      void sincronizar().catch(() => undefined);
    }
  }, [online, tenantSlug, cargandoSesion, pendientes, sincronizar]);

  useEffect(() => {
    if (!online || cargandoSesion || pendientes <= 0) return;
    const retryTimer = setInterval(() => void sincronizar().catch(() => undefined), 15000);
    return () => clearInterval(retryTimer);
  }, [online, tenantSlug, cargandoSesion, pendientes, sincronizar]);

  const marcarOnboardingVisto = useCallback(async () => {
    setOnboardingVisto(true);
    await AsyncStorage.setItem(onboardingKey(tenantSlug), '1');
  }, [tenantSlug]);

  const value = useMemo<AppContextValue>(
    () => ({
      tenantSlug,
      cambiarTenant,
      usuario,
      iniciarSesion,
      cerrarSesion,
      carrito,
      agregarAlCarrito,
      quitarDelCarrito,
      limpiarCarrito,
      cola,
      pendientes,
      online,
      encolarVenta,
      encolarReserva,
      sincronizar,
      refrescar,
      toast,
      mostrarToast,
      onboardingVisto,
      marcarOnboardingVisto,
      cargandoSesion,
      factoryResetVersion,
    }),
    [
      tenantSlug, cambiarTenant, usuario, iniciarSesion, cerrarSesion, carrito, agregarAlCarrito,
      quitarDelCarrito, limpiarCarrito, cola, pendientes, online, encolarVenta, encolarReserva,
      sincronizar, refrescar, toast, mostrarToast, onboardingVisto, marcarOnboardingVisto, cargandoSesion,
      factoryResetVersion,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp debe usarse dentro de AppProvider');
  return ctx;
}
