-- =============================================================================
-- MIGRACION 006: Unicidad de correo, SKU y maestros dentro de cada Tenant
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_tenant_email
  ON usuarios (tenant_id, LOWER(email));

CREATE UNIQUE INDEX IF NOT EXISTS uq_variantes_tenant_sku
  ON variantes (tenant_id, UPPER(sku));

CREATE UNIQUE INDEX IF NOT EXISTS uq_categorias_tenant_slug
  ON categorias (tenant_id, LOWER(slug));

INSERT INTO meta (clave, valor, actualizado_en)
VALUES ('esquema_version', '6', NOW())
ON CONFLICT (clave) DO UPDATE SET valor = '6', actualizado_en = NOW();
