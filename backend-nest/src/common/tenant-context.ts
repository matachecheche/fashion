import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantInfo {
  tenantId: string;
  tenantSlug: string;
  nombre: string;
  plan: string;
  estado: string;
  demoIniciaEn: string;
  demoVenceEn: string;
  writeAllowed: boolean;
  maxUsuarios: number;
  maxSucursales: number;
  maxProductos: number;
}

const storage = new AsyncLocalStorage<TenantInfo>();

export const TenantContext = {
  run<T>(tenant: TenantInfo, callback: () => T): T {
    return storage.run(tenant, callback);
  },
  get(): TenantInfo | undefined {
    return storage.getStore();
  },
  require(): TenantInfo {
    const store = storage.getStore();
    if (!store || !store.tenantId) {
      throw new Error('TENANT_CONTEXT_REQUIRED: No se resolvio una tienda valida para esta solicitud.');
    }
    return store;
  },
};
