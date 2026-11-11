-- =============================================================================
-- MIGRACION 008: Planes de Suscripcion y Solicitudes de Cambio (Sin Cobro Real)
-- =============================================================================

CREATE TABLE IF NOT EXISTS planes_suscripcion (
  codigo VARCHAR(32) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  precio_mensual_bs NUMERIC(10, 2) NOT NULL DEFAULT 0,
  duracion_dias INTEGER,
  max_usuarios INTEGER NOT NULL,
  max_sucursales INTEGER NOT NULL,
  max_productos INTEGER NOT NULL,
  facturable BOOLEAN NOT NULL DEFAULT FALSE,
  descripcion TEXT NOT NULL
);

INSERT INTO planes_suscripcion (codigo, nombre, precio_mensual_bs, duracion_dias, max_usuarios, max_sucursales, max_productos, facturable, descripcion)
VALUES
  ('demo', 'Demo Gratuito 14 Dias', 0, 14, 5, 2, 500, FALSE, 'Prueba gratuita por 14 dias sin tarjeta ni cobro real. Al vencer pasa a modo solo lectura.'),
  ('basico', 'Plan Basico Boutique', 190, NULL, 10, 3, 1500, FALSE, 'Plan comercial para boutiques en crecimiento (solicitud sujeta a aprobacion, modo sandbox).'),
  ('profesional', 'Plan Profesional Multitienda', 390, NULL, 25, 8, 5000, FALSE, 'Plan para cadenas regionales con analitica avanzada y probador AR (modo sandbox).'),
  ('empresarial', 'Plan Empresarial Ilimitado', 790, NULL, 100, 25, 25000, FALSE, 'Plan corporativo multi-sucursal (solicitud sujeta a aprobacion, sin cobro automatico).')
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  max_usuarios = EXCLUDED.max_usuarios,
  max_sucursales = EXCLUDED.max_sucursales,
  max_productos = EXCLUDED.max_productos;

CREATE TABLE IF NOT EXISTS solicitudes_suscripcion (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL DEFAULT COALESCE(public.current_tenant_id(), 'legacy') REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  plan_actual VARCHAR(32) NOT NULL,
  plan_solicitado VARCHAR(32) NOT NULL REFERENCES planes_suscripcion(codigo),
  estado VARCHAR(24) NOT NULL DEFAULT 'pendiente_aprobacion'
    CHECK (estado IN ('pendiente_aprobacion', 'aprobada_sandbox', 'rechazada')),
  cobro_real BOOLEAN NOT NULL DEFAULT FALSE CHECK (cobro_real = FALSE),
  notas TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE solicitudes_suscripcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_suscripcion FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON solicitudes_suscripcion;
CREATE POLICY tenant_isolation_select ON solicitudes_suscripcion
  FOR SELECT USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_write ON solicitudes_suscripcion;
CREATE POLICY tenant_isolation_write ON solicitudes_suscripcion
  FOR ALL
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id() AND cobro_real = FALSE);

GRANT SELECT ON planes_suscripcion TO app_runtime, app_readonly, web_anon, app_user;
GRANT SELECT, INSERT, UPDATE ON solicitudes_suscripcion TO app_runtime;
GRANT USAGE, SELECT ON SEQUENCE solicitudes_suscripcion_id_seq TO app_runtime;
GRANT SELECT ON solicitudes_suscripcion TO app_readonly;

INSERT INTO meta (clave, valor, actualizado_en)
VALUES ('esquema_version', '8', NOW())
ON CONFLICT (clave) DO UPDATE SET valor = '8', actualizado_en = NOW();
