-- =============================================================================
-- MIGRACION 007: Feed incremental de cambios de catalogo (/sync/pull) por Tenant
-- =============================================================================

CREATE TABLE IF NOT EXISTS catalogo_cambios_feed (
  seq BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL DEFAULT COALESCE(public.current_tenant_id(), 'legacy') REFERENCES tenants(id) ON DELETE CASCADE,
  entidad VARCHAR(40) NOT NULL,
  entidad_id VARCHAR(64) NOT NULL,
  accion VARCHAR(20) NOT NULL CHECK (accion IN ('upsert', 'delete')),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalogo_cambios_feed_tenant_seq
  ON catalogo_cambios_feed (tenant_id, seq ASC);

ALTER TABLE catalogo_cambios_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_cambios_feed FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON catalogo_cambios_feed;
CREATE POLICY tenant_isolation_select ON catalogo_cambios_feed
  FOR SELECT USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_write ON catalogo_cambios_feed;
CREATE POLICY tenant_isolation_write ON catalogo_cambios_feed
  FOR ALL
  USING (tenant_id = public.current_tenant_id() AND public.tenant_write_allowed(tenant_id))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.tenant_write_allowed(tenant_id));

CREATE OR REPLACE FUNCTION registrar_cambio_catalogo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid VARCHAR(64);
  v_id TEXT;
  v_accion VARCHAR(20);
  v_payload JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tid := OLD.tenant_id;
    v_id := OLD.id::TEXT;
    v_accion := 'delete';
    v_payload := to_jsonb(OLD);
  ELSE
    v_tid := NEW.tenant_id;
    v_id := NEW.id::TEXT;
    v_accion := 'upsert';
    v_payload := to_jsonb(NEW);
  END IF;

  INSERT INTO public.catalogo_cambios_feed (tenant_id, entidad, entidad_id, accion, payload_json, actualizado_en)
  VALUES (v_tid, TG_TABLE_NAME, v_id, v_accion, v_payload, NOW());

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_productos ON productos;
CREATE TRIGGER trg_feed_productos
  AFTER INSERT OR UPDATE OR DELETE ON productos
  FOR EACH ROW EXECUTE FUNCTION registrar_cambio_catalogo();

DROP TRIGGER IF EXISTS trg_feed_variantes ON variantes;
CREATE TRIGGER trg_feed_variantes
  AFTER INSERT OR UPDATE OR DELETE ON variantes
  FOR EACH ROW EXECUTE FUNCTION registrar_cambio_catalogo();

DROP TRIGGER IF EXISTS trg_feed_stock ON stock;
CREATE TRIGGER trg_feed_stock
  AFTER INSERT OR UPDATE OR DELETE ON stock
  FOR EACH ROW EXECUTE FUNCTION registrar_cambio_catalogo();

GRANT SELECT, INSERT, UPDATE, DELETE ON catalogo_cambios_feed TO app_runtime;
GRANT USAGE, SELECT ON SEQUENCE catalogo_cambios_feed_seq_seq TO app_runtime;
GRANT SELECT ON catalogo_cambios_feed TO app_readonly, web_anon, app_user;

INSERT INTO meta (clave, valor, actualizado_en)
VALUES ('esquema_version', '7', NOW())
ON CONFLICT (clave) DO UPDATE SET valor = '7', actualizado_en = NOW();
