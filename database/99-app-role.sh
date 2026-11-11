#!/bin/sh
# =============================================================================
# FASHIONSTORE — Rol de aplicación `fs_app` (LOGIN, NOSUPERUSER, sin BYPASSRLS)
# Se ejecuta UNA sola vez al inicializar el volumen de PostgreSQL (compose).
# La contraseña real viene de FS_APP_PASSWORD (entorno del contenedor).
# No hay contraseñas reales en el repositorio: el valor por defecto solo sirve
# para desarrollo local y docker compose lo documenta.
# =============================================================================
set -eu

FS_APP_PASSWORD="${FS_APP_PASSWORD:-cambiar_esta_contrasena_local}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v FS_APP_PASSWORD="$FS_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE fs_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS', :'FS_APP_PASSWORD')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fs_app')\gexec
GRANT app_runtime TO fs_app;
GRANT app_readonly TO fs_app;
GRANT USAGE ON SCHEMA public TO fs_app;
SQL

echo "fashionstore db: rol fs_app listo (membresia app_runtime + app_readonly)"
