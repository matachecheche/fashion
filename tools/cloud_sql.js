// Helper SQL para Neon/PostgreSQL, usado solo como alternativa a psql en el despliegue.
// Resuelve `pg` desde backend-nest/node_modules; no instala ni modifica dependencias.
// Variables: DATABASE_URL, FS_BACKEND_DIR y, para provision, FS_APP_PASSWORD.
// Comandos: file <ruta.sql> | scalar <SQL> | provision | verify-app
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const backendDir = process.env.FS_BACKEND_DIR || path.resolve(__dirname, '..', 'backend-nest');
let Client;
try {
  ({ Client } = require(require.resolve('pg', { paths: [backendDir] })));
} catch (_error) {
  console.error('SQL ERROR: no se encontró el paquete pg en backend-nest. Ejecuta npm ci dentro de backend-nest, o instala psql.');
  process.exit(2);
}

function createClient() {
  const raw = String(process.env.DATABASE_URL || '').trim();
  if (!raw) throw new Error('falta DATABASE_URL');

  let url;
  try {
    url = new URL(raw);
  } catch (_error) {
    throw new Error('DATABASE_URL no es una URL PostgreSQL válida');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL debe usar PostgreSQL');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const sslmode = String(url.searchParams.get('sslmode') || 'require').toLowerCase();
  if (!local && !['require', 'verify-ca', 'verify-full'].includes(sslmode)) {
    throw new Error('Neon requiere TLS (sslmode=require o más estricto)');
  }

  // Fijamos TLS y verificación del certificado explícitamente. Quitar los parámetros
  // SSL de la URL evita que pg-connection-string sobrescriba el objeto ssl explícito.
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword', 'channel_binding']) {
    url.searchParams.delete(key);
  }
  return new Client({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: true },
    connectionTimeoutMillis: 30000,
    statement_timeout: 0,
    application_name: 'fashionstore-azure-deploy',
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const client = createClient();
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      if (attempt < 4) await sleep(attempt * 1500);
    }
  }
  throw lastError || new Error('no se pudo conectar a PostgreSQL');
}

async function provision(client) {
  const appPassword = process.env.FS_APP_PASSWORD || '';
  if (appPassword.length < 32) throw new Error('FS_APP_PASSWORD debe tener al menos 32 caracteres');

  await client.query('BEGIN');
  try {
    // El rol puede existir de una ejecución previa. Se actualiza de forma segura,
    // pero jamás se actualizan ni desactivan usuarios de demostración.
    const role = await client.query(
      "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fashionstore_app') AS present"
    );
    if (!role.rows[0] || !role.rows[0].present) {
      await client.query(
        'CREATE ROLE fashionstore_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
      );
    }
    const passwordSql = await client.query(
      "SELECT format('ALTER ROLE fashionstore_app WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS', $1::text) AS command",
      [appPassword]
    );
    if (!passwordSql.rows[0] || !passwordSql.rows[0].command) {
      throw new Error('PostgreSQL no pudo preparar la actualización del rol runtime');
    }
    await client.query(passwordSql.rows[0].command);
    await client.query('GRANT app_runtime TO fashionstore_app');
    await client.query('GRANT app_readonly TO fashionstore_app');
    await client.query('GRANT USAGE ON SCHEMA public TO fashionstore_app');
    await client.query('COMMIT');
    process.stdout.write('PROVISION OK\n');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function verifyApp(client) {
  const role = await client.query(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
  );
  if (!role.rows[0] || role.rows[0].rolsuper || role.rows[0].rolbypassrls) {
    throw new Error('el rol runtime tiene SUPERUSER o BYPASSRLS');
  }

  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE app_readonly');
    const meta = await client.query(
      "SELECT valor FROM public.meta WHERE clave = 'esquema_version'"
    );
    await client.query("SELECT set_config('app.tenant_id', 'legacy', true)");
    const account = await client.query(
      "SELECT count(*)::text AS count FROM public.usuarios " +
      "WHERE tenant_id = 'legacy' AND email = 'admin@fashionstore.bo'"
    );
    const accountCount = account.rows[0] ? account.rows[0].count : '0';
    if (accountCount !== '1') throw new Error('el rol runtime no puede leer la cuenta semilla bajo RLS');
    await client.query('COMMIT');
    process.stdout.write(
      `VERIFY OK esquema_version=${meta.rows[0] ? meta.rows[0].valor : '?'} cuenta_admin=${accountCount}\n`
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (!['file', 'scalar', 'provision', 'verify-app'].includes(command)) {
    throw new Error('uso: cloud_sql.js file <ruta.sql> | scalar <SQL> | provision | verify-app');
  }
  if ((command === 'file' || command === 'scalar') && !argument) {
    throw new Error(`falta el argumento para ${command}`);
  }

  const client = await connectWithRetry();
  try {
    if (command === 'file') {
      const sqlPath = path.resolve(argument);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      // Sin parámetros, node-postgres usa el protocolo simple de PostgreSQL y acepta
      // archivos con varias sentencias, funciones PL/pgSQL y dollar-quoting.
      await client.query(sql);
      process.stdout.write(`SQL OK: ${path.basename(sqlPath)}\n`);
    } else if (command === 'scalar') {
      const result = await client.query(argument);
      const row = result.rows && result.rows[0];
      const value = row ? Object.values(row)[0] : null;
      // JSON de una sola línea preserva nulos, booleanos y texto sin ambigüedad.
      process.stdout.write(`${JSON.stringify(value === undefined ? null : value)}\n`);
    } else if (command === 'provision') {
      await provision(client);
    } else if (command === 'verify-app') {
      await verifyApp(client);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  const position = error && error.position ? ` (posición ${error.position})` : '';
  console.error(`SQL ERROR: ${message}${position}`);
  process.exitCode = 1;
});
