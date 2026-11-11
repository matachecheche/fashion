-- =============================================================================
-- MIGRACION 003: Cola durable de operaciones offline e idempotencia
-- =============================================================================

ALTER TABLE operaciones_offline
  ADD COLUMN IF NOT EXISTS actor_rol VARCHAR(32) DEFAULT 'cliente',
  ADD COLUMN IF NOT EXISTS intentos INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS codigo_conflicto VARCHAR(64),
  ADD COLUMN IF NOT EXISTS compensacion_json JSONB;

CREATE INDEX IF NOT EXISTS idx_operaciones_offline_usuario_estado
  ON operaciones_offline (usuario_id, estado, creado_en DESC);

INSERT INTO meta (clave, valor, actualizado_en)
VALUES ('esquema_version', '4', NOW())
ON CONFLICT (clave) DO UPDATE SET actualizado_en = NOW();
