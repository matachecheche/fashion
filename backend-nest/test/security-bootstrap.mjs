/**
 * Regression checks for security-sensitive Nest/Express bootstrap behavior.
 * Runs against the compiled API without PostgreSQL; all probes stop in middleware
 * before any database query. Requires `npm run build` first.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const ALLOWED_ORIGIN = 'https://security-check.example.test';
const DENIED_ORIGIN = 'https://untrusted.example.test';
const API_PREFIX = '/api';

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function startApi(port, jwtSecret) {
  const child = spawn(process.execPath, [MAIN], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      DATABASE_URL: 'postgresql://postgres@127.0.0.1:1/fashionstore_security_test',
      DATABASE_SSL: 'false',
      JWT_SECRET: jwtSecret,
      CORS_ORIGINS: ALLOWED_ORIGIN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return { child, get output() { return output; } };
}

async function waitForReady(app, marker, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (app.output.includes(marker)) return;
    if (app.child.exitCode !== null) {
      throw new Error(`Nest terminó antes de quedar listo (exit ${app.child.exitCode}). Salida: ${app.output.slice(-1200)}`);
    }
    await delay(25);
  }
  throw new Error(`Timeout esperando el arranque de NestJS. Salida: ${app.output.slice(-1200)}`);
}

async function waitForExit(handle, timeoutMs = 5000) {
  if (handle.child.exitCode !== null) return { code: handle.child.exitCode, signal: handle.child.signalCode };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      handle.child.kill('SIGKILL');
      reject(new Error('El proceso Nest no terminó dentro del tiempo esperado.'));
    }, timeoutMs);
    handle.child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    handle.child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function stopApi(handle) {
  if (handle.child.exitCode !== null) return;
  handle.child.kill('SIGTERM');
  await waitForExit(handle, 2500);
}

async function checkInvalidJwtSecretFailsClosed() {
  const port = await reservePort();
  const app = startApi(port, 'short-test-secret');
  const exit = await waitForExit(app, 5000);
  assert.equal(exit.code, 1, 'API debe negarse a iniciar con JWT_SECRET demasiado corto');
  assert.match(app.output, /JWT_SECRET_REQUIRED/);
  assert.ok(!app.output.includes('short-test-secret'), 'El secreto de prueba no debe aparecer en logs');
}

async function checkHttpSecurityAndLimiters() {
  const port = await reservePort();
  const app = startApi(port, randomBytes(48).toString('hex'));
  const readyMarker = `escuchando en http://0.0.0.0:${port}/api`;
  try {
    await waitForReady(app, readyMarker);
    assert.doesNotMatch(app.output, /Unsupported route path|Missing parameter name/);
    const base = `http://127.0.0.1:${port}${API_PREFIX}`;

    const allowed = await fetch(`${base}/__security_probe__`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    const allowedBody = await allowed.json();
    assert.equal(allowed.status, 400);
    assert.equal(allowedBody.error, 'TENANT_SLUG_REQUIRED', 'El middleware wildcard debe cubrir rutas API no registradas');
    assert.equal(allowed.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff');
    assert.match(allowed.headers.get('content-security-policy') || '', /default-src 'self'/);

    const denied = await fetch(`${base}/__security_probe__`, {
      headers: { Origin: DENIED_ORIGIN },
    });
    assert.equal(denied.headers.get('access-control-allow-origin'), null, 'CORS no debe reflejar orígenes no permitidos');
    await denied.arrayBuffer();

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const response = await fetch(`${base}/auth/login`, { method: 'GET' });
      await response.arrayBuffer();
      assert.notEqual(response.status, 429, `El límite de login no debe activarse antes del intento 21 (intento ${attempt})`);
    }
    const limited = await fetch(`${base}/auth/login`, { method: 'GET' });
    const limitedBody = await limited.json();
    assert.equal(limited.status, 429);
    assert.equal(limitedBody.error, 'RATE_LIMIT_LOGIN');
  } finally {
    await stopApi(app);
  }
}

async function run() {
  await checkInvalidJwtSecretFailsClosed();
  await checkHttpSecurityAndLimiters();
  console.log('OK: security-bootstrap.mjs (JWT fail-closed, Helmet, CORS, wildcard middleware, rate limit).');
}

run().catch((error) => {
  console.error('FALLO en security-bootstrap.mjs:', error.message);
  process.exit(1);
});
