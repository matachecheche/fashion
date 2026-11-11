-- =============================================================================
-- MIGRACION 010: contratos SaaS, idempotencia, sincronizacion, credito, pagos, ML y auditoria
-- Aditiva e idempotente. Conserva tenants y tablas heredadas con tenant_id VARCHAR(64)
-- para no romper CU-01..CU-14; los tenants nuevos usan UUID textual como id.
-- =============================================================================

BEGIN;

-- Planes / limites / capacidades. -1 en max_productos significa ilimitado.
ALTER TABLE public.planes_suscripcion
  ADD COLUMN IF NOT EXISTS funciones_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_plan_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_plan_check
  CHECK (plan IN ('demo', 'trial', 'basico', 'profesional', 'empresarial'));

-- -1 is the documented sentinel for an unlimited product quota.
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_max_productos_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_max_productos_check
  CHECK (max_productos > 0 OR max_productos = -1);

UPDATE public.planes_suscripcion SET
  nombre = 'Trial gratuito 14 días', duracion_dias = 14,
  max_usuarios = 3, max_sucursales = 1, max_productos = 200,
  funciones_json = '{"ml":false,"voz":false,"exportaciones_masivas":false,"dashboard_ampliado":false}'::jsonb
WHERE codigo = 'demo';

INSERT INTO public.planes_suscripcion
  (codigo, nombre, precio_mensual_bs, duracion_dias, max_usuarios, max_sucursales, max_productos, facturable, descripcion, funciones_json)
VALUES
  ('trial', 'Trial gratuito 14 días', 0, 14, 3, 1, 200, FALSE,
   'Prueba gratuita de 14 días; solo lectura al vencer.',
   '{"ml":false,"voz":false,"exportaciones_masivas":false,"dashboard_ampliado":false}'::jsonb),
  ('basico', 'Plan Básico', 190, NULL, 10, 2, 2000, FALSE,
   'Plan para una boutique en crecimiento.',
   '{"ml":false,"voz":false,"exportaciones_masivas":false,"dashboard_ampliado":false}'::jsonb),
  ('profesional', 'Plan Profesional', 390, NULL, 50, 10, -1, FALSE,
   'Analítica avanzada, reportes por voz y exportación masiva.',
   '{"ml":true,"voz":true,"exportaciones_masivas":true,"dashboard_ampliado":true}'::jsonb),
  ('empresarial', 'Plan Empresarial', 790, NULL, 100, 25, -1, FALSE,
   'Capacidades avanzadas para operación multi-sucursal.',
   '{"ml":true,"voz":true,"exportaciones_masivas":true,"dashboard_ampliado":true}'::jsonb)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  duracion_dias = EXCLUDED.duracion_dias,
  max_usuarios = EXCLUDED.max_usuarios,
  max_sucursales = EXCLUDED.max_sucursales,
  max_productos = EXCLUDED.max_productos,
  facturable = EXCLUDED.facturable,
  descripcion = EXCLUDED.descripcion,
  funciones_json = EXCLUDED.funciones_json;

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS nit VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_nit
  ON public.tenants (nit) WHERE nit IS NOT NULL AND btrim(nit) <> '';

CREATE TABLE IF NOT EXISTS public.suscripciones (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_codigo VARCHAR(32) NOT NULL REFERENCES public.planes_suscripcion(codigo),
  estado VARCHAR(24) NOT NULL DEFAULT 'activa'
    CHECK (estado IN ('activa', 'vencida', 'suspendida', 'cancelada', 'pendiente_pago')),
  inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vence_en TIMESTAMPTZ,
  modo_cobro VARCHAR(24) NOT NULL DEFAULT 'prueba'
    CHECK (modo_cobro IN ('prueba', 'stripe_test', 'paypal_sandbox', 'libelula_test')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);

INSERT INTO public.suscripciones (tenant_id, plan_codigo, estado, inicio, vence_en, modo_cobro)
SELECT t.id,
       CASE WHEN t.plan = 'demo' THEN 'demo' ELSE t.plan END,
       CASE WHEN t.estado = 'suspendido' THEN 'suspendida'
            WHEN t.demo_vence_en <= NOW() AND t.plan IN ('demo', 'trial') THEN 'vencida'
            ELSE 'activa' END,
       t.demo_inicia_en, t.demo_vence_en, 'prueba'
  FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;

-- Tabla de idempotencia general por tenant. response_json se guarda solo para operaciones
-- completadas; no se registran secretos ni datos de tarjeta.
CREATE TABLE IF NOT EXISTS public.idempotencia (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  clave VARCHAR(128) NOT NULL,
  hash_request CHAR(64) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'EN_PROCESO'
    CHECK (estado IN ('EN_PROCESO', 'COMPLETADA', 'FALLIDA')),
  respuesta JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, clave)
);

CREATE TABLE IF NOT EXISTS public.dispositivos_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  usuario_id INTEGER,
  device_key VARCHAR(128) NOT NULL,
  plataforma VARCHAR(24) NOT NULL CHECK (plataforma IN ('web', 'android', 'ios', 'otro')),
  etiqueta VARCHAR(120),
  cursor_pull BIGINT NOT NULL DEFAULT 0 CHECK (cursor_pull >= 0),
  ultima_sync_en TIMESTAMPTZ,
  ultimo_visto_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, device_key)
);

CREATE TABLE IF NOT EXISTS public.conflictos_sync (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  operacion_id VARCHAR(80) NOT NULL,
  dispositivo_id UUID REFERENCES public.dispositivos_sync(id) ON DELETE SET NULL,
  tipo VARCHAR(40) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'RESUELTO', 'DESCARTADO')),
  regla VARCHAR(80) NOT NULL DEFAULT 'STOCK_ATOMICO_PRIMERA_CONFIRMADA',
  payload_local JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_servidor JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolucion VARCHAR(40),
  resuelto_por INTEGER,
  resuelto_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, operacion_id)
);

-- Venta a crédito y abonos; la venta se confirma y descuenta stock, pero no se registra
-- como ingreso pagado hasta que existan abonos.
ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS es_credito BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS credito_vencimiento TIMESTAMPTZ;
ALTER TABLE public.pagos ALTER COLUMN webhook_id TYPE VARCHAR(160);
ALTER TABLE public.pagos DROP CONSTRAINT IF EXISTS pagos_estado_check;
ALTER TABLE public.pagos
  ADD CONSTRAINT pagos_estado_check
  CHECK (estado IN ('pendiente', 'no_confirmado', 'aprobado', 'rechazado', 'expirado', 'reembolsado', 'aprobado_sin_venta', 'reembolso_pendiente'));
ALTER TABLE public.ventas DROP CONSTRAINT IF EXISTS ventas_estado_check;
ALTER TABLE public.ventas
  ADD CONSTRAINT ventas_estado_check
  CHECK (estado IN ('pendiente_pago', 'pagada', 'entregada', 'cancelada', 'reembolsada', 'conflicto_stock', 'fallida_stock'));
ALTER TABLE public.ventas DROP CONSTRAINT IF EXISTS ventas_estado_pago_check;
ALTER TABLE public.ventas
  ADD CONSTRAINT ventas_estado_pago_check
  CHECK (estado_pago IN ('pendiente', 'no_confirmado', 'aprobado', 'rechazado', 'reembolsado', 'expirado', 'aprobado_sin_venta', 'reembolso_pendiente'));
ALTER TABLE public.ventas DROP CONSTRAINT IF EXISTS ventas_metodo_pago_check;
ALTER TABLE public.ventas
  ADD CONSTRAINT ventas_metodo_pago_check
  CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'qr', 'transferencia', 'credito', 'stripe_sandbox', 'libelula_sandbox'));

CREATE TABLE IF NOT EXISTS public.cuentas_por_cobrar (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  venta_id INTEGER NOT NULL,
  cliente_id INTEGER,
  cliente_nombre VARCHAR(140) NOT NULL,
  cliente_telefono VARCHAR(40),
  cliente_correo VARCHAR(160),
  monto_original NUMERIC(12,2) NOT NULL CHECK (monto_original > 0),
  monto_abonado NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monto_abonado >= 0),
  saldo NUMERIC(12,2) NOT NULL CHECK (saldo >= 0),
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'PARCIAL', 'PAGADA', 'VENCIDA')),
  vence_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, venta_id),
  CHECK (monto_abonado <= monto_original),
  CHECK (ABS(saldo - (monto_original - monto_abonado)) < 0.01)
);

CREATE TABLE IF NOT EXISTS public.abonos_cuenta (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cuenta_id BIGINT NOT NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago VARCHAR(24) NOT NULL CHECK (metodo_pago IN ('efectivo', 'qr', 'transferencia', 'tarjeta')),
  referencia VARCHAR(120),
  registrado_por INTEGER,
  notas TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reportes_generados (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  usuario_id INTEGER,
  solicitud TEXT NOT NULL,
  especificacion_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  filtros_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  resultado_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  motor VARCHAR(32) NOT NULL DEFAULT 'reglas_locales',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.modelos_ml (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  algoritmo VARCHAR(64) NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  estado VARCHAR(24) NOT NULL DEFAULT 'APROBADO'
    CHECK (estado IN ('ENTRENANDO', 'APROBADO', 'NO_APROBADO', 'ERROR')),
  semilla INTEGER NOT NULL,
  metricas JSONB NOT NULL DEFAULT '{}'::jsonb,
  features_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  modelo BYTEA,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, algoritmo, version)
);

CREATE TABLE IF NOT EXISTS public.predicciones (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  modelo_id BIGINT,
  entidad_tipo VARCHAR(32) NOT NULL,
  entidad_id VARCHAR(80),
  valor_json JSONB NOT NULL,
  es_sintetico BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.segmentos_cliente (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  modelo_id BIGINT,
  cliente_id INTEGER,
  cluster_id INTEGER NOT NULL,
  perfil_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  recomendacion TEXT,
  es_sintetico BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.saga_pago (
  saga_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  operacion_id VARCHAR(128) NOT NULL,
  venta_id INTEGER,
  pago_id INTEGER,
  estado VARCHAR(28) NOT NULL DEFAULT 'INICIADA'
    CHECK (estado IN ('INICIADA', 'PAGO_PENDIENTE', 'PAGO_APROBADO', 'VENTA_CONFIRMADA', 'COMPENSANDO', 'COMPENSADA', 'REQUIERE_INTERVENCION')),
  paso_actual VARCHAR(32) NOT NULL DEFAULT 'T1',
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  ultimo_error TEXT,
  datos_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, operacion_id)
);

-- Backfill: every legacy payment gets a durable saga before the reconciler is enabled.
INSERT INTO public.saga_pago (tenant_id, operacion_id, venta_id, pago_id, estado, paso_actual)
SELECT pg.tenant_id,
       pg.referencia_externa,
       pg.venta_id,
       pg.id,
       CASE WHEN pg.estado = 'aprobado' THEN 'VENTA_CONFIRMADA'
            WHEN pg.estado IN ('rechazado', 'expirado', 'reembolsado') THEN 'COMPENSADA'
            ELSE 'PAGO_PENDIENTE' END,
       CASE WHEN pg.estado = 'aprobado' THEN 'T4'
            WHEN pg.estado IN ('rechazado', 'expirado', 'reembolsado') THEN 'C1'
            ELSE 'T2' END
  FROM public.pagos pg
ON CONFLICT (tenant_id, operacion_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.webhooks_recibidos (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  event_id VARCHAR(160) NOT NULL UNIQUE,
  referencia VARCHAR(160) NOT NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  firma_valida BOOLEAN NOT NULL,
  procesado BOOLEAN NOT NULL DEFAULT FALSE,
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  ultimo_error TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  recibido_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  procesado_en TIMESTAMPTZ
);
ALTER TABLE public.webhooks_recibidos
  ADD COLUMN IF NOT EXISTS intentos INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_error TEXT;

-- Auditoría global de alta: permite dejar constancia de un fallo antes de que exista el tenant.
-- La huella excluye contraseñas en claro; respuesta_json se usa solo para replay idempotente.
CREATE TABLE IF NOT EXISTS public.auditoria_aprovisionamiento (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64),
  tenant_slug VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'EN_PROCESO'
    CHECK (estado IN ('EN_PROCESO', 'COMPLETADA', 'FALLIDA')),
  respuesta_json JSONB,
  codigo_error VARCHAR(64),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_slug, idempotency_key)
);

-- Expose only same-tenant aggregate status to the read-only assistant role; raw
-- onboarding hashes, replay payloads, identifiers and errors remain inaccessible.
CREATE OR REPLACE FUNCTION public.assistant_aprovisionamiento_estados()
RETURNS TABLE(estado VARCHAR(20), cantidad BIGINT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.estado, COUNT(*)::BIGINT AS cantidad
    FROM public.auditoria_aprovisionamiento a
   WHERE a.tenant_id = public.current_tenant_id()
   GROUP BY a.estado;
$$;
REVOKE ALL ON FUNCTION public.assistant_aprovisionamiento_estados() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assistant_aprovisionamiento_estados() TO app_runtime, app_readonly;

-- Synthetic-data traceability.
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS es_sintetico BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS es_sintetico BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.variantes ADD COLUMN IF NOT EXISTS es_sintetico BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.stock ADD COLUMN IF NOT EXISTS es_sintetico BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.ventas ADD COLUMN IF NOT EXISTS es_sintetico BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.venta_items ADD COLUMN IF NOT EXISTS es_sintetico BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.movimientos_inventario ADD COLUMN IF NOT EXISTS es_sintetico BOOLEAN NOT NULL DEFAULT FALSE;

-- Tenant isolation and indexes for every new business table.
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'idempotencia', 'dispositivos_sync', 'conflictos_sync', 'cuentas_por_cobrar',
    'abonos_cuenta', 'reportes_generados', 'modelos_ml', 'predicciones',
    'segmentos_cliente', 'saga_pago', 'webhooks_recibidos'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)', 'idx_' || t || '_tenant', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON public.%I FOR SELECT USING (tenant_id = public.current_tenant_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation_write ON public.%I FOR ALL USING (tenant_id = public.current_tenant_id() AND public.tenant_write_allowed(tenant_id)) WITH CHECK (tenant_id = public.current_tenant_id() AND public.tenant_write_allowed(tenant_id))', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_write_active_%I ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_write_active_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_active()', t, t);
  END LOOP;
END $$;

-- Composite tenant keys prevent relations from crossing stores.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_cuentas_por_cobrar_tenant_id') THEN
    ALTER TABLE public.cuentas_por_cobrar ADD CONSTRAINT uq_cuentas_por_cobrar_tenant_id UNIQUE (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cuentas_venta_tenant') THEN
    ALTER TABLE public.cuentas_por_cobrar ADD CONSTRAINT fk_cuentas_venta_tenant
      FOREIGN KEY (tenant_id, venta_id) REFERENCES public.ventas(tenant_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_abonos_cuenta_tenant') THEN
    ALTER TABLE public.abonos_cuenta ADD CONSTRAINT fk_abonos_cuenta_tenant
      FOREIGN KEY (tenant_id, cuenta_id) REFERENCES public.cuentas_por_cobrar(tenant_id, id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cuentas_tenant_saldo ON public.cuentas_por_cobrar (tenant_id, saldo DESC) WHERE saldo > 0;
CREATE INDEX IF NOT EXISTS idx_pagos_expiracion_pending ON public.pagos (tenant_id, expira_en, id) WHERE estado IN ('pendiente', 'no_confirmado');
CREATE INDEX IF NOT EXISTS idx_saga_pago_reanudable ON public.saga_pago (tenant_id, estado, actualizado_en) WHERE estado IN ('INICIADA', 'PAGO_PENDIENTE', 'PAGO_APROBADO', 'COMPENSANDO');
CREATE INDEX IF NOT EXISTS idx_reportes_tenant_fecha ON public.reportes_generados (tenant_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_modelos_ml_tenant_algoritmo_version ON public.modelos_ml (tenant_id, algoritmo, version DESC);
CREATE INDEX IF NOT EXISTS idx_saga_pago_pendiente ON public.saga_pago (tenant_id, estado, actualizado_en) WHERE estado NOT IN ('VENTA_CONFIRMADA', 'COMPENSADA');
CREATE INDEX IF NOT EXISTS idx_webhooks_pendientes ON public.webhooks_recibidos (tenant_id, recibido_en) WHERE procesado = FALSE;

-- Global tables are accessible to the application role only for narrow reads/writes; tenant scoping
-- is mandatory in application queries. The report role gets provisioning states only through the
-- SECURITY DEFINER aggregate above, never raw hashes, idempotency keys, response payloads or errors.
GRANT SELECT, INSERT, UPDATE ON public.suscripciones TO app_runtime;
GRANT SELECT ON public.suscripciones TO app_readonly;
GRANT SELECT, INSERT, UPDATE ON public.auditoria_aprovisionamiento TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.idempotencia, public.dispositivos_sync, public.conflictos_sync,
  public.cuentas_por_cobrar, public.abonos_cuenta, public.reportes_generados,
  public.modelos_ml, public.predicciones, public.segmentos_cliente,
  public.saga_pago, public.webhooks_recibidos TO app_runtime;
GRANT SELECT ON
  public.idempotencia, public.dispositivos_sync, public.conflictos_sync,
  public.cuentas_por_cobrar, public.abonos_cuenta, public.reportes_generados,
  public.modelos_ml, public.predicciones, public.segmentos_cliente,
  public.saga_pago, public.webhooks_recibidos TO app_readonly;
GRANT SELECT ON public.planes_suscripcion TO app_runtime, app_readonly;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO app_runtime, app_readonly;
GRANT EXECUTE ON FUNCTION public.tenant_write_allowed(VARCHAR) TO app_runtime, app_readonly;

-- El rol de reportes no debe leer hashes de contraseña ni tokens personales.
REVOKE SELECT ON public.usuarios FROM app_readonly;
GRANT SELECT (id, tenant_id, nombre, email, rol, telefono, sucursal_id, proveedor_id, activo, preferencias_json, creado_en, es_sintetico)
  ON public.usuarios TO app_readonly;

CREATE OR REPLACE FUNCTION public.tenant_write_allowed(p_tenant_id VARCHAR(64))
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado VARCHAR(24);
  v_plan VARCHAR(32);
  v_vence TIMESTAMPTZ;
BEGIN
  IF p_tenant_id IS NULL OR p_tenant_id = '' THEN RETURN FALSE; END IF;
  SELECT estado, plan, demo_vence_en INTO v_estado, v_plan, v_vence
    FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND OR v_estado <> 'activo' THEN RETURN FALSE; END IF;
  IF v_plan IN ('demo', 'trial') AND v_vence <= NOW() THEN RETURN FALSE; END IF;
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tenant_write_allowed(VARCHAR) TO app_runtime, app_readonly;

-- Honor the same trial expiry policy in quota checks, and treat max_productos=-1 as unlimited.
CREATE OR REPLACE FUNCTION public.enforce_tenant_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id VARCHAR(64);
  v_max_usuarios INTEGER;
  v_max_sucursales INTEGER;
  v_max_productos INTEGER;
  v_plan VARCHAR(32);
  v_estado VARCHAR(24);
  v_vence TIMESTAMPTZ;
  v_actual INTEGER;
BEGIN
  v_tenant_id := NEW.tenant_id;
  IF v_tenant_id IS NULL OR v_tenant_id = '' THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED: tenant_id es obligatorio.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('quota_' || TG_TABLE_NAME || '_' || v_tenant_id));
  SELECT plan, estado, demo_vence_en, max_usuarios, max_sucursales, max_productos
    INTO v_plan, v_estado, v_vence, v_max_usuarios, v_max_sucursales, v_max_productos
    FROM public.tenants WHERE id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND: La tienda % no existe.', v_tenant_id USING ERRCODE = '42501';
  END IF;
  IF v_estado <> 'activo' OR (v_plan IN ('demo', 'trial') AND v_vence <= NOW()) THEN
    RAISE EXCEPTION 'DEMO_EXPIRED_READ_ONLY: El periodo Trial/Demo de la tienda % ha vencido. Modo solo lectura activo.', v_tenant_id
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'usuarios' THEN
    SELECT COUNT(*) INTO v_actual FROM public.usuarios WHERE tenant_id = v_tenant_id;
    IF v_max_usuarios > 0 AND v_actual >= v_max_usuarios THEN
      RAISE EXCEPTION 'QUOTA_EXCEEDED_USERS: Limite del plan alcanzado (% usuarios maximos por tienda).', v_max_usuarios USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'sucursales' THEN
    SELECT COUNT(*) INTO v_actual FROM public.sucursales WHERE tenant_id = v_tenant_id;
    IF v_max_sucursales > 0 AND v_actual >= v_max_sucursales THEN
      RAISE EXCEPTION 'QUOTA_EXCEEDED_BRANCHES: Limite del plan alcanzado (% sucursales maximas por tienda).', v_max_sucursales USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'productos' THEN
    SELECT COUNT(*) INTO v_actual FROM public.productos WHERE tenant_id = v_tenant_id;
    IF v_max_productos > 0 AND v_actual >= v_max_productos THEN
      RAISE EXCEPTION 'QUOTA_EXCEEDED_PRODUCTS: Limite del plan alcanzado (% productos maximos por tienda).', v_max_productos USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.suspender_trials_vencidos()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n INTEGER;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('fashionstore_trial_sweep')) THEN
    RETURN 0;
  END IF;
  UPDATE public.tenants
     SET estado = 'suspendido', actualizado_en = NOW()
   WHERE plan IN ('demo', 'trial') AND estado = 'activo' AND demo_vence_en <= NOW();
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.suscripciones
     SET estado = 'suspendida', actualizado_en = NOW()
   WHERE plan_codigo IN ('demo', 'trial') AND estado = 'activa' AND vence_en <= NOW();
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.suspender_trials_vencidos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suspender_trials_vencidos() TO app_runtime;

INSERT INTO public.meta (clave, valor, actualizado_en)
VALUES ('esquema_version', '10', NOW())
ON CONFLICT (clave) DO UPDATE SET valor = '10', actualizado_en = NOW();

COMMIT;
