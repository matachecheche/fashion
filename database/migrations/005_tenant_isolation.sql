-- =============================================================================
-- MIGRACION 005: Aislamiento Multi-Tenant, RLS Forzado, Cuotas Demo 14 Dias,
-- Claves Foraneas Compuestas Tenant-Aware y Rol Runtime sin BYPASSRLS
-- =============================================================================

-- 1. Tabla maestra de Tenants (tiendas SaaS)
CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(64) PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$'),
  nombre VARCHAR(160) NOT NULL,
  plan VARCHAR(32) NOT NULL DEFAULT 'demo' CHECK (plan IN ('demo', 'basico', 'profesional', 'empresarial')),
  estado VARCHAR(24) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'suspendido', 'vencido')),
  demo_inicia_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  demo_vence_en TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  max_usuarios INTEGER NOT NULL DEFAULT 5 CHECK (max_usuarios > 0),
  max_sucursales INTEGER NOT NULL DEFAULT 2 CHECK (max_sucursales > 0),
  max_productos INTEGER NOT NULL DEFAULT 500 CHECK (max_productos > 0),
  config_json JSONB NOT NULL DEFAULT '{"moneda":"BOB","pais":"BO","pagosModo":"sandbox"}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant inicial para datos preexistentes (primer parcial)
INSERT INTO tenants (id, slug, nombre, plan, estado, demo_inicia_en, demo_vence_en, max_usuarios, max_sucursales, max_productos)
VALUES (
  'legacy',
  'legacy',
  'FashionStore Central (Legacy)',
  'demo',
  'activo',
  NOW(),
  NOW() + INTERVAL '14 days',
  5,
  2,
  500
)
ON CONFLICT (id) DO NOTHING;

-- 2. Funciones de contexto transaccional y politicas de expiracion Demo
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS VARCHAR(64)
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::VARCHAR(64);
$$;

CREATE OR REPLACE FUNCTION tenant_write_allowed(p_tenant_id VARCHAR(64))
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
  IF p_tenant_id IS NULL OR p_tenant_id = '' THEN
    RETURN FALSE;
  END IF;
  SELECT estado, plan, demo_vence_en
    INTO v_estado, v_plan, v_vence
    FROM public.tenants
   WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  IF v_estado <> 'activo' THEN
    RETURN FALSE;
  END IF;
  IF v_plan = 'demo' AND v_vence <= NOW() THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END;
$$;

-- 3. Agregar columna tenant_id a todas las tablas de negocio
DO $$
DECLARE
  t TEXT;
  tablas TEXT[] := ARRAY[
    'sucursales', 'almacenes', 'proveedores', 'usuarios',
    'categorias', 'temporadas', 'colecciones', 'productos',
    'producto_imagenes', 'variantes', 'promociones', 'stock',
    'movimientos_inventario', 'recepciones', 'recepcion_items',
    'cajas', 'reservas', 'detalle_reserva', 'operaciones_offline',
    'ventas', 'venta_items', 'pagos', 'devoluciones',
    'devolucion_items', 'propuestas_producto', 'interacciones',
    'recomendaciones_ia', 'conversaciones_ia', 'notificaciones', 'auditoria'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT COALESCE(public.current_tenant_id(), ''legacy'') REFERENCES public.tenants(id) ON DELETE CASCADE',
      t
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)',
      'idx_' || t || '_tenant_id', t
    );
  END LOOP;
END $$;

-- 4. Claves unicas compuestas (tenant_id, id) para permitir FKs compuestas tenant-aware
DO $$
DECLARE
  t TEXT;
  tablas_pk TEXT[] := ARRAY[
    'sucursales', 'almacenes', 'proveedores', 'usuarios',
    'categorias', 'temporadas', 'colecciones', 'productos',
    'variantes', 'promociones', 'stock', 'recepciones',
    'cajas', 'reservas', 'operaciones_offline', 'ventas', 'devoluciones'
  ];
BEGIN
  FOREACH t IN ARRAY tablas_pk LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'uq_' || t || '_tenant_id_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (tenant_id, id)',
        t, 'uq_' || t || '_tenant_id_id'
      );
    END IF;
  END LOOP;
END $$;

-- 5. Claves foraneas compuestas (tenant_id, parent_id) para impedir referencias cross-tenant
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_almacenes_tenant_sucursal') THEN
    ALTER TABLE almacenes
      ADD CONSTRAINT fk_almacenes_tenant_sucursal
      FOREIGN KEY (tenant_id, sucursal_id) REFERENCES sucursales(tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_productos_tenant_categoria') THEN
    ALTER TABLE productos
      ADD CONSTRAINT fk_productos_tenant_categoria
      FOREIGN KEY (tenant_id, categoria_id) REFERENCES categorias(tenant_id, id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_variantes_tenant_producto') THEN
    ALTER TABLE variantes
      ADD CONSTRAINT fk_variantes_tenant_producto
      FOREIGN KEY (tenant_id, producto_id) REFERENCES productos(tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stock_tenant_almacen') THEN
    ALTER TABLE stock
      ADD CONSTRAINT fk_stock_tenant_almacen
      FOREIGN KEY (tenant_id, almacen_id) REFERENCES almacenes(tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stock_tenant_variante') THEN
    ALTER TABLE stock
      ADD CONSTRAINT fk_stock_tenant_variante
      FOREIGN KEY (tenant_id, variante_id) REFERENCES variantes(tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_reservas_tenant_usuario') THEN
    ALTER TABLE reservas
      ADD CONSTRAINT fk_reservas_tenant_usuario
      FOREIGN KEY (tenant_id, usuario_id) REFERENCES usuarios(tenant_id, id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_reservas_tenant_sucursal') THEN
    ALTER TABLE reservas
      ADD CONSTRAINT fk_reservas_tenant_sucursal
      FOREIGN KEY (tenant_id, sucursal_id) REFERENCES sucursales(tenant_id, id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_detalle_reserva_tenant_reserva') THEN
    ALTER TABLE detalle_reserva
      ADD CONSTRAINT fk_detalle_reserva_tenant_reserva
      FOREIGN KEY (tenant_id, reserva_id) REFERENCES reservas(tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ventas_tenant_sucursal') THEN
    ALTER TABLE ventas
      ADD CONSTRAINT fk_ventas_tenant_sucursal
      FOREIGN KEY (tenant_id, sucursal_id) REFERENCES sucursales(tenant_id, id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_venta_items_tenant_venta') THEN
    ALTER TABLE venta_items
      ADD CONSTRAINT fk_venta_items_tenant_venta
      FOREIGN KEY (tenant_id, venta_id) REFERENCES ventas(tenant_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pagos_tenant_venta') THEN
    ALTER TABLE pagos
      ADD CONSTRAINT fk_pagos_tenant_venta
      FOREIGN KEY (tenant_id, venta_id) REFERENCES ventas(tenant_id, id) ON DELETE CASCADE;
  END IF;
END $$;

-- 6. Trigger transaccional de cuotas del plan Demo (5 usuarios, 2 sucursales, 500 productos)
CREATE OR REPLACE FUNCTION enforce_tenant_quota()
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
    RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED: tenant_id es obligatorio.'
      USING ERRCODE = '42501';
  END IF;

  -- Serializar verificacion de cuota por tenant dentro de la transaccion
  PERFORM pg_advisory_xact_lock(hashtext('quota_' || TG_TABLE_NAME || '_' || v_tenant_id));

  SELECT plan, estado, demo_vence_en, max_usuarios, max_sucursales, max_productos
    INTO v_plan, v_estado, v_vence, v_max_usuarios, v_max_sucursales, v_max_productos
    FROM public.tenants
   WHERE id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND: La tienda % no existe.', v_tenant_id
      USING ERRCODE = '42501';
  END IF;

  IF v_estado <> 'activo' OR (v_plan = 'demo' AND v_vence <= NOW()) THEN
    RAISE EXCEPTION 'DEMO_EXPIRED_READ_ONLY: El periodo Demo de la tienda % ha vencido. Modo solo lectura activo.', v_tenant_id
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'usuarios' THEN
    SELECT COUNT(*) INTO v_actual FROM public.usuarios WHERE tenant_id = v_tenant_id;
    IF v_actual >= v_max_usuarios THEN
      RAISE EXCEPTION 'QUOTA_EXCEEDED_USERS: Limite del plan alcanzado (% usuarios maximos por tienda).', v_max_usuarios
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'sucursales' THEN
    SELECT COUNT(*) INTO v_actual FROM public.sucursales WHERE tenant_id = v_tenant_id;
    IF v_actual >= v_max_sucursales THEN
      RAISE EXCEPTION 'QUOTA_EXCEEDED_BRANCHES: Limite del plan alcanzado (% sucursales maximas por tienda).', v_max_sucursales
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'productos' THEN
    SELECT COUNT(*) INTO v_actual FROM public.productos WHERE tenant_id = v_tenant_id;
    IF v_actual >= v_max_productos THEN
      RAISE EXCEPTION 'QUOTA_EXCEEDED_PRODUCTS: Limite del plan alcanzado (% productos maximos por tienda).', v_max_productos
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quota_usuarios ON usuarios;
CREATE TRIGGER trg_quota_usuarios
  BEFORE INSERT ON usuarios
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_quota();

DROP TRIGGER IF EXISTS trg_quota_sucursales ON sucursales;
CREATE TRIGGER trg_quota_sucursales
  BEFORE INSERT ON sucursales
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_quota();

DROP TRIGGER IF EXISTS trg_quota_productos ON productos;
CREATE TRIGGER trg_quota_productos
  BEFORE INSERT ON productos
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_quota();

-- 7. Trigger universal de bloqueo de escrituras cuando Demo vence
CREATE OR REPLACE FUNCTION enforce_tenant_write_active()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid VARCHAR(64);
BEGIN
  v_tid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  IF NOT public.tenant_write_allowed(v_tid) THEN
    RAISE EXCEPTION 'DEMO_EXPIRED_READ_ONLY: Escrituras bloqueadas para el tenant % (Demo vencido o tienda inactiva).', v_tid
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- 8. Activar RLS y FORCE ROW LEVEL SECURITY en todas las tablas de tenant
DO $$
DECLARE
  t TEXT;
  tablas TEXT[] := ARRAY[
    'sucursales', 'almacenes', 'proveedores', 'usuarios',
    'categorias', 'temporadas', 'colecciones', 'productos',
    'producto_imagenes', 'variantes', 'promociones', 'stock',
    'movimientos_inventario', 'recepciones', 'recepcion_items',
    'cajas', 'reservas', 'detalle_reserva', 'operaciones_offline',
    'ventas', 'venta_items', 'pagos', 'devoluciones',
    'devolucion_items', 'propuestas_producto', 'interacciones',
    'recomendaciones_ia', 'conversaciones_ia', 'notificaciones', 'auditoria'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON public.%I FOR SELECT USING (tenant_id = public.current_tenant_id())',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_write ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_write ON public.%I FOR ALL USING (tenant_id = public.current_tenant_id() AND public.tenant_write_allowed(tenant_id)) WITH CHECK (tenant_id = public.current_tenant_id() AND public.tenant_write_allowed(tenant_id))',
      t
    );

    EXECUTE format('DROP TRIGGER IF EXISTS trg_write_active_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_write_active_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_write_active()',
      t, t
    );
  END LOOP;
END $$;

-- 9. Recrear vistas con filtro explicito de tenant
DROP VIEW IF EXISTS disponibilidad_sucursal;
CREATE VIEW disponibilidad_sucursal AS
SELECT
  s.tenant_id,
  s.id AS stock_id,
  suc.id AS sucursal_id,
  suc.nombre AS sucursal_nombre,
  suc.ciudad,
  a.id AS almacen_id,
  a.nombre AS almacen_nombre,
  p.id AS producto_id,
  p.codigo AS producto_codigo,
  p.nombre AS producto_nombre,
  p.tipo_prenda,
  p.precio_base,
  v.id AS variante_id,
  v.sku,
  v.talla,
  v.color,
  v.color_hex,
  COALESCE(v.foto_url, p.imagen_url) AS foto_url,
  COALESCE(v.ar_url, p.ar_overlay_url) AS ar_url,
  (p.precio_base + v.precio_adicional) AS precio_final,
  s.cantidad,
  s.reservado,
  (s.cantidad - s.reservado) AS disponible,
  s.stock_minimo
FROM stock s
JOIN almacenes a ON a.tenant_id = s.tenant_id AND a.id = s.almacen_id
JOIN sucursales suc ON suc.tenant_id = a.tenant_id AND suc.id = a.sucursal_id
JOIN variantes v ON v.tenant_id = s.tenant_id AND v.id = s.variante_id
JOIN productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id
WHERE s.tenant_id = public.current_tenant_id()
  AND p.activo = TRUE AND v.activa = TRUE AND suc.activa = TRUE;

DROP VIEW IF EXISTS catalogo_publico;
CREATE VIEW catalogo_publico AS
SELECT
  p.tenant_id,
  p.id,
  p.codigo,
  p.nombre,
  p.descripcion,
  p.tipo_prenda,
  p.genero,
  p.material,
  p.precio_base,
  p.imagen_url,
  p.ar_overlay_url,
  p.ar_config_json,
  p.destacado,
  c.id AS categoria_id,
  c.nombre AS categoria_nombre,
  t.id AS temporada_id,
  t.nombre AS temporada_nombre,
  col.id AS coleccion_id,
  col.nombre AS coleccion_nombre,
  COALESCE(SUM(s.cantidad - s.reservado), 0)::INTEGER AS stock_disponible_total
FROM productos p
JOIN categorias c ON c.tenant_id = p.tenant_id AND c.id = p.categoria_id
LEFT JOIN temporadas t ON t.tenant_id = p.tenant_id AND t.id = p.temporada_id
LEFT JOIN colecciones col ON col.tenant_id = p.tenant_id AND col.id = p.coleccion_id
LEFT JOIN variantes v ON v.tenant_id = p.tenant_id AND v.producto_id = p.id AND v.activa = TRUE
LEFT JOIN stock s ON s.tenant_id = v.tenant_id AND s.variante_id = v.id
WHERE p.tenant_id = public.current_tenant_id()
  AND p.activo = TRUE
GROUP BY p.tenant_id, p.id, c.id, t.id, col.id;

DROP VIEW IF EXISTS inventario_critico;
CREATE VIEW inventario_critico AS
SELECT
  s.tenant_id,
  suc.id AS sucursal_id,
  suc.nombre AS sucursal_nombre,
  a.id AS almacen_id,
  a.nombre AS almacen_nombre,
  p.id AS producto_id,
  p.nombre AS producto_nombre,
  v.id AS variante_id,
  v.sku,
  v.talla,
  v.color,
  s.cantidad,
  s.reservado,
  (s.cantidad - s.reservado) AS disponible,
  s.stock_minimo
FROM stock s
JOIN almacenes a ON a.tenant_id = s.tenant_id AND a.id = s.almacen_id
JOIN sucursales suc ON suc.tenant_id = a.tenant_id AND suc.id = a.sucursal_id
JOIN variantes v ON v.tenant_id = s.tenant_id AND v.id = s.variante_id
JOIN productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id
WHERE s.tenant_id = public.current_tenant_id()
  AND (s.cantidad - s.reservado) <= s.stock_minimo;

-- 10. Permisos minimos para app_runtime y app_readonly (sin SUPERUSER ni BYPASSRLS)
-- Neon es PostgreSQL administrado: el rol owner recibe membresía en neon_superuser,
-- pero no tiene el atributo PostgreSQL SUPERUSER. Por eso ALTER ROLE ... NOSUPERUSER
-- falla incluso cuando el rol de destino ya es no-superusuario. Los roles se crean
-- sin SUPERUSER por defecto en schema.sql; aquí solo se ajustan atributos que el owner
-- puede restringir y después se comprueba explícitamente el estado efectivo del rol.
ALTER ROLE app_runtime NOLOGIN NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE app_readonly NOLOGIN NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname IN ('app_runtime', 'app_readonly')
       AND (rolsuper OR rolcanlogin OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Los roles app_runtime/app_readonly deben ser NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE y NOBYPASSRLS';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_runtime, app_readonly, web_anon, app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly, web_anon, app_user;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO app_runtime, app_readonly, web_anon, app_user;
GRANT EXECUTE ON FUNCTION public.tenant_write_allowed(VARCHAR) TO app_runtime, app_readonly, web_anon, app_user;

DO $$
BEGIN
  EXECUTE format('GRANT app_runtime TO %I', current_user);
  EXECUTE format('GRANT app_readonly TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

INSERT INTO meta (clave, valor, actualizado_en)
VALUES ('esquema_version', '5', NOW())
ON CONFLICT (clave) DO UPDATE SET valor = '5', actualizado_en = NOW();
