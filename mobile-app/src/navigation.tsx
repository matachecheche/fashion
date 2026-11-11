/**
 * Navegación mínima y determinista (tabs + stack propio).
 * Evita dependencias de react-navigation/versions y mantiene el bundle liviano.
 */
import React, { createContext, useCallback, useContext, useState } from 'react';

export type TabName = 'inicio' | 'catalogo' | 'vestidor' | 'carrito' | 'cuenta';
export type ScreenName =
  | 'Producto'
  | 'ProbadorAR'
  | 'Reservar'
  | 'Checkout'
  | 'Pago'
  | 'Pedidos'
  | 'Reservas'
  | 'Auth'
  | 'Asistente'
  | 'Ayuda'
  | 'Onboarding'
  | 'Panel'
  | 'Maestros'
  | 'Notificaciones';

export interface StackEntry {
  name: ScreenName;
  params?: Record<string, any>;
}

interface NavContextValue {
  tab: TabName;
  setTab: (t: TabName) => void;
  stack: StackEntry[];
  push: (name: ScreenName, params?: Record<string, any>) => void;
  pop: () => void;
  popToRoot: () => void;
}

const NavContext = createContext<NavContextValue | undefined>(undefined);

export const NavProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tab, setTab] = useState<TabName>('inicio');
  const [stack, setStack] = useState<StackEntry[]>([]);

  const push = useCallback((name: ScreenName, params?: Record<string, any>) => {
    setStack((prev) => [...prev, { name, params }]);
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }, []);

  const popToRoot = useCallback(() => setStack([]), []);

  return (
    <NavContext.Provider value={{ tab, setTab, stack, push, pop, popToRoot }}>
      {children}
    </NavContext.Provider>
  );
};

export function useNav(): NavContextValue {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav debe usarse dentro de NavProvider');
  return ctx;
}
