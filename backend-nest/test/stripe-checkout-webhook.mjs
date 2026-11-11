import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('../dist/main.js', import.meta.url));

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

function startApi(port, jwtSecret, stripeSecret, webhookSecret) {
  const child = spawn(process.execPath, [MAIN], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      DATABASE_URL: 'postgresql://postgres@127.0.0.1:1/fashionstore_stripe_webhook_test',
      DATABASE_SSL: 'false',
      JWT_SECRET: jwtSecret,
      PAGOS_MODO: 'sandbox',
      STRIPE_SECRET_KEY: stripeSecret,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      PUBLIC_API_URL: 'https://fashionstore.example.test',
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
      throw new Error(`Nest terminó antes de quedar listo. Salida: ${app.output.slice(-1200)}`);
    }
    await delay(25);
  }
  throw new Error(`Timeout esperando el arranque de NestJS. Salida: ${app.output.slice(-1200)}`);
}

async function stopApi(handle) {
  if (handle.child.exitCode !== null) return;
  handle.child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => handle.child.once('exit', resolve)),
    delay(2500).then(() => handle.child.kill('SIGKILL')),
  ]);
}

function signature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

const port = await reservePort();
const jwtSecret = randomBytes(48).toString('hex');
const stripeSecret = `rk_test_${randomBytes(32).toString('hex')}`;
const webhookSecret = `whsec_${randomBytes(32).toString('hex')}`;
const app = startApi(port, jwtSecret, stripeSecret, webhookSecret);
const marker = `[FashionStore NestJS] API SaaS multi-tenant escuchando en http://0.0.0.0:${port}/api`;

try {
  await waitForReady(app, marker);
  const base = `http://127.0.0.1:${port}/api`;
  const webhookUrl = `${base}/pagos/webhooks/stripe-checkout`;
  const payload = JSON.stringify({
    id: `evt_test_${randomBytes(8).toString('hex')}`,
    object: 'event',
    api_version: '2026-10-28.preview',
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: `pi_test_${randomBytes(8).toString('hex')}`, object: 'payment_intent', metadata: {} } },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'payment_intent.created',
  });

  const invalid = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=invalid' },
    body: payload,
  });
  assert.equal(invalid.status, 401, `El webhook sin firma válida debe ser rechazado, no por tenant middleware. Respuesta: ${await invalid.text()}`);

  const signed = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature(payload, webhookSecret) },
    body: payload,
  });
  const signedText = await signed.text();
  assert.equal(signed.status, 200, `Un evento Stripe firmado pero ajeno debe recibirse e ignorarse. Respuesta: ${signedText}`);
  assert.deepEqual(JSON.parse(signedText), { recibido: true, ignorado: true });

  const unpaidPayload = JSON.stringify({
    id: `evt_test_${randomBytes(8).toString('hex')}`,
    object: 'event',
    api_version: '2026-10-28.preview',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `cs_test_${randomBytes(8).toString('hex')}`,
        object: 'checkout.session',
        client_reference_id: '1',
        currency: 'bob',
        amount_total: 12500,
        metadata: {
          fashionstore_payment_id: '1',
          tenant_id: '1',
          tenant_slug: 'legacy',
          reference: 'PAY-TEST-UNPAID',
        },
        payment_status: 'unpaid',
        status: 'complete',
      },
    },
    livemode: false,
    pending_webhooks: 1,
    type: 'checkout.session.completed',
  });
  const unpaid = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature(unpaidPayload, webhookSecret) },
    body: unpaidPayload,
  });
  const unpaidText = await unpaid.text();
  assert.equal(unpaid.status, 200, `Un Checkout sin estado paid debe ignorarse antes de tocar la base de datos. Respuesta: ${unpaidText}`);
  assert.deepEqual(JSON.parse(unpaidText), { recibido: true, ignorado: true, motivo: 'pago_aun_no_pagado' });

  const returnPage = await fetch(`${base}/pagos/stripe/retorno?resultado=exito`);
  assert.equal(returnPage.status, 200);
  assert.match(returnPage.headers.get('content-type') || '', /text\/html/i);
  assert.match(await returnPage.text(), /Stripe recibió el intento de prueba/);

  assert.doesNotMatch(app.output, new RegExp(stripeSecret));
  assert.doesNotMatch(app.output, new RegExp(webhookSecret));
  console.log('OK: firmas válidas/inválidas, evento ajeno y Checkout no pagado ignorados, rutas globales y retorno HTML verificados.');
} finally {
  await stopApi(app);
}
