-- =============================================================================
-- MIGRACION 004: Idempotencia para reservas originadas offline
-- =============================================================================

ALTER TABLE reservas
  ADD COLUMN IF NOT EXISTS operacion_offline_id VARCHAR(80) REFERENCES operaciones_offline(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payload_hash VARCHAR(128),
  ADD COLUMN IF NOT EXISTS origen VARCHAR(24) NOT NULL DEFAULT 'web';

CREATE UNIQUE INDEX IF NOT EXISTS uq_reservas_operacion_offline_id
  ON reservas (operacion_offline_id)
  WHERE operacion_offline_id IS NOT NULL;
