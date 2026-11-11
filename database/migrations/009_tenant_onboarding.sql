-- =============================================================================
-- MIGRACION 009: Onboarding de Tiendas SaaS y Consentimiento Explicito Demo
-- =============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS acepta_demo BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS onboarding_completado BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_propietario VARCHAR(160),
  ADD COLUMN IF NOT EXISTS rubro VARCHAR(80) NOT NULL DEFAULT 'Moda y Confeccion',
  ADD COLUMN IF NOT EXISTS moneda VARCHAR(12) NOT NULL DEFAULT 'BOB',
  ADD COLUMN IF NOT EXISTS zona_horaria VARCHAR(64) NOT NULL DEFAULT 'America/La_Paz';

GRANT SELECT, INSERT, UPDATE ON tenants TO app_runtime;
GRANT SELECT ON tenants TO app_readonly, web_anon, app_user;

INSERT INTO meta (clave, valor, actualizado_en)
VALUES ('esquema_version', '9', NOW())
ON CONFLICT (clave) DO UPDATE SET valor = '9', actualizado_en = NOW();
