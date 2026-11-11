/**
 * Suite de pruebas integrales Smoke (Multi-Tenant, RLS, Pagos Sandbox, Offline Sync y Conflicto de Stock)
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const BASE_URL = (process.env.API_URL || 'http://127.0.0.1:3000/api').replace(/\/+$/, '');

async function request(path, { method = 'GET', tenant = 'legacy', token = null, body = null, headers: extraHeaders = {} } = {}) {
  const headers = {
    Accept: 'application/json',
    'X-Tenant-Slug': tenant,
    ...extraHeaders,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

async function run() {
  console.log('=== [1/6] Verificando salud de NestJS y version de esquema ===');
  const health = await request('/salud');
  assert.equal(health.status, 200);
  assert.equal(health.data.estado, 'ok');
  assert.equal(health.data.schema_version, 10);
  assert.match(String(health.data.factory_generation || ''), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'health publica el UUID de generación sembrado en cada reset de fábrica');

  console.log('=== [2/6] Login en tenant legacy y verificacion de catalogo ===');
  const loginLegacy = await request('/auth/login', {
    method: 'POST',
    tenant: 'legacy',
    body: { email: 'admin@fashionstore.bo', password: 'Fashion2026!' },
  });
  assert.equal(loginLegacy.status, 201);
  assert.ok(loginLegacy.data.access_token);
  const legacyToken = loginLegacy.data.access_token;

  const catLegacy = await request('/catalogo/productos', { tenant: 'legacy' });
  assert.equal(catLegacy.status, 200);
  assert.ok(catLegacy.data.length >= 8, 'El tenant legacy debe tener al menos 8 productos');

  const factorySales = await request('/ventas', { tenant: 'legacy', token: legacyToken });
  assert.equal(factorySales.status, 200);
  assert.ok(factorySales.data.some((sale) => Number(sale.id) === 6 && sale.es_credito === true),
    'el seed de fábrica debe dejar visible una cuenta a crédito de ejemplo');
  const factorySagas = await request('/pagos/sagas', { tenant: 'legacy', token: legacyToken });
  assert.equal(factorySagas.status, 200);
  assert.ok(factorySagas.data.some((saga) => saga.operacion_id === 'PAY-DEMO-0004' && saga.estado === 'PAGO_PENDIENTE'),
    'el seed posterior a migración debe crear sagas para pagos de fábrica');

  console.log('=== [3/6] Onboarding de nuevo tenant y verificacion de aislamiento RLS ===');
  const uniqueSlug = `boutique-smoke-${Date.now().toString(36)}`;
  const registrationBody = {
    nombre_tienda: 'Boutique Smoke Test',
    slug: uniqueSlug,
    ciudad: 'Cochabamba',
    nit: String(Date.now()).slice(-10),
    acepta_trial: true,
    admin_nombre: 'Admin Smoke',
    admin_email: `admin@${uniqueSlug}.bo`,
    admin_password: 'Fashion2026!',
  };
  const idempotencyKey = `reg-${uniqueSlug}`;
  const regTenant = await request('/tenants/registro', {
    method: 'POST',
    tenant: 'legacy',
    body: registrationBody,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  assert.equal(regTenant.status, 201);
  assert.equal(regTenant.data.tenant.slug, uniqueSlug);
  assert.equal(regTenant.data.tenant.plan, 'trial');
  assert.ok(regTenant.data.tenant.id);
  assert.ok(regTenant.data.access_token);
  const replayTenant = await request('/tenants/registro', {
    method: 'POST',
    tenant: 'legacy',
    body: registrationBody,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  assert.equal(replayTenant.status, 201);
  assert.equal(replayTenant.data.idempotent_replay, true);
  assert.equal(replayTenant.data.tenant.id, regTenant.data.tenant.id);
  const replayMismatch = await request('/tenants/registro', {
    method: 'POST',
    tenant: 'legacy',
    body: { ...registrationBody, nombre_tienda: 'Datos distintos' },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  assert.equal(replayMismatch.status, 422, 'Reutilizar una clave idempotente con otro payload debe devolver 422');
  const newTenantToken = regTenant.data.access_token;

  // El nuevo tenant NO debe ver los productos de legacy
  const catNew = await request('/catalogo/productos', { tenant: uniqueSlug });
  assert.equal(catNew.status, 200);
  assert.equal(catNew.data.length, 0, 'Aislamiento RLS: nuevo tenant debe iniciar con 0 productos');
  const subscriptionNew = await request('/suscripcion/estado', { tenant: uniqueSlug, token: newTenantToken });
  assert.equal(subscriptionNew.status, 200);
  assert.equal(subscriptionNew.data.plan_actual, 'trial');
  assert.equal(subscriptionNew.data.cuotas.usuarios.maximo, 3);
  assert.equal(subscriptionNew.data.cuotas.sucursales.maximo, 1);
  assert.equal(subscriptionNew.data.cuotas.productos.maximo, 200);

  // Token de legacy NO debe ser aceptado en el nuevo tenant
  const crossTokenAttempt = await request('/ventas', {
    tenant: uniqueSlug,
    token: legacyToken,
  });
  assert.equal(crossTokenAttempt.status, 403, 'Debe rechazar JWT emitido para otro tenant');

  console.log('=== [4/6] Verificando cobro Sandbox (QR/Tarjeta quedan no_confirmado hasta aprobacion) ===');
  const primeraVariante = catLegacy.data[0].variantes[0];
  const ventaQr = await request('/ventas', {
    method: 'POST',
    tenant: 'legacy',
    token: legacyToken,
    body: {
      sucursal_id: 1,
      metodo_pago: 'qr',
      origen: 'web',
      items: [{ variante_id: primeraVariante.id, cantidad: 1 }],
    },
  });
  assert.equal(ventaQr.status, 201);
  assert.equal(ventaQr.data.estado, 'pendiente_pago');
  assert.equal(ventaQr.data.estado_pago, 'no_confirmado');
  assert.equal(ventaQr.data.pago.confirmado_proveedor, false);
  const pagoQr = await request(`/pagos/${ventaQr.data.pago.id}`, { tenant: 'legacy', token: legacyToken });
  assert.equal(pagoQr.status, 200);
  assert.equal(pagoQr.data.qr_es_sandbox, true);
  assert.match(pagoQr.data.qr_data_url, /^data:image\/png;base64,/);
  const qrPayload = JSON.parse(pagoQr.data.qr_payload);
  assert.equal(qrPayload.formato, 'fashionstore-qr-sandbox-v1');
  assert.equal(qrPayload.referencia, ventaQr.data.pago.referencia_externa);
  assert.equal(Number(qrPayload.monto), Number(ventaQr.data.pago.monto));
  assert.ok(pagoQr.data.qr_aviso.includes('no se puede cobrar'));
  const sagasPendientes = await request('/pagos/sagas', { tenant: 'legacy', token: legacyToken });
  assert.equal(sagasPendientes.status, 200);
  assert.ok(sagasPendientes.data.some((s) => s.operacion_id === ventaQr.data.pago.referencia_externa && s.estado === 'PAGO_PENDIENTE'));

  // Webhook firmado: monto, referencia, tenant y event_id quedan validados antes de confirmar.
  const webhookEvent = {
    event_id: `EVT-SMOKE-${Date.now()}`,
    tenant_id: 'legacy',
    tenant_slug: 'legacy',
    reference: ventaQr.data.pago.referencia_externa,
    amount: Number(ventaQr.data.pago.monto),
    currency: 'BOB',
    status: 'approved',
  };
  const webhookRaw = JSON.stringify(webhookEvent);
  const webhookSecret = process.env.LIBELULA_WEBHOOK_SECRET || 'libelula_sandbox_webhook_secret_2026';
  const webhookSignature = createHmac('sha256', webhookSecret).update(webhookRaw).digest('hex');
  const mismatchEvent = { ...webhookEvent, event_id: `${webhookEvent.event_id}-AMOUNT`, amount: webhookEvent.amount + 0.01 };
  const mismatchRaw = JSON.stringify(mismatchEvent);
  const mismatchSignature = createHmac('sha256', webhookSecret).update(mismatchRaw).digest('hex');
  const webhookAmountMismatch = await request('/pagos/webhooks/libelula', {
    method: 'POST',
    tenant: 'legacy',
    body: mismatchEvent,
    headers: { 'X-Provider-Signature': `sha256=${mismatchSignature}` },
  });
  assert.equal(webhookAmountMismatch.status, 422, 'Firma válida con monto distinto debe rechazarse');
  const webhookBad = await request('/pagos/webhooks/libelula', {
    method: 'POST',
    tenant: 'legacy',
    body: webhookEvent,
    headers: { 'X-Provider-Signature': 'sha256=' + '0'.repeat(64) },
  });
  assert.equal(webhookBad.status, 401, 'Webhook con firma inválida debe rechazarse');
  const aprobarPago = await request('/pagos/webhooks/libelula', {
    method: 'POST',
    tenant: 'legacy',
    body: webhookEvent,
    headers: { 'X-Provider-Signature': `sha256=${webhookSignature}` },
  });
  assert.equal(aprobarPago.status, 200);
  assert.equal(aprobarPago.data.pago.estado, 'aprobado');
  const webhookReplay = await request('/pagos/webhooks/libelula', {
    method: 'POST',
    tenant: 'legacy',
    body: webhookEvent,
    headers: { 'X-Provider-Signature': `sha256=${webhookSignature}` },
  });
  assert.equal(webhookReplay.status, 200);
  assert.equal(webhookReplay.data.duplicado, true);
  const pagoConfirmado = await request(`/pagos/${ventaQr.data.pago.id}`, { tenant: 'legacy', token: legacyToken });
  assert.equal(pagoConfirmado.data.estado, 'aprobado');
  assert.equal(Object.hasOwn(pagoConfirmado.data, 'qr_data_url'), false, 'QR debe retirarse al confirmar');
  const sagasConfirmadas = await request('/pagos/sagas', { tenant: 'legacy', token: legacyToken });
  assert.ok(sagasConfirmadas.data.some((s) => s.operacion_id === ventaQr.data.pago.referencia_externa && s.estado === 'VENTA_CONFIRMADA'));

  console.log('=== [5/6] Verificando idempotencia Offline Sync y deteccion de payload alterado ===');
  const opKey = `OFF-IDEMP-${Date.now()}`;
  const sync1 = await request('/ventas/sincronizar-offline', {
    method: 'POST',
    tenant: 'legacy',
    token: legacyToken,
    body: {
      operaciones: [
        {
          id: opKey,
          sucursal_id: 1,
          metodo_pago: 'efectivo',
          origen: 'offline_pos',
          items: [{ variante_id: primeraVariante.id, cantidad: 1 }],
        },
      ],
    },
  });
  assert.equal(sync1.status, 201);
  assert.equal(sync1.data.sincronizadas, 1);
  assert.equal(sync1.data.resultados[0].idempotent_replay, false);

  // Reenviar misma clave con mismo payload -> idempotent_replay = true, sin doble cobro
  const syncReplay = await request('/ventas/sincronizar-offline', {
    method: 'POST',
    tenant: 'legacy',
    token: legacyToken,
    body: {
      operaciones: [
        {
          id: opKey,
          sucursal_id: 1,
          metodo_pago: 'efectivo',
          origen: 'offline_pos',
          items: [{ variante_id: primeraVariante.id, cantidad: 1 }],
        },
      ],
    },
  });
  assert.equal(syncReplay.status, 201);
  assert.equal(syncReplay.data.resultados[0].idempotent_replay, true);

  // Reenviar misma clave con payload distinto -> rechazada por IDEMPOTENCY_PAYLOAD_MISMATCH
  const syncMismatch = await request('/ventas/sincronizar-offline', {
    method: 'POST',
    tenant: 'legacy',
    token: legacyToken,
    body: {
      operaciones: [
        {
          id: opKey,
          sucursal_id: 1,
          metodo_pago: 'efectivo',
          origen: 'offline_pos',
          items: [{ variante_id: primeraVariante.id, cantidad: 2 }],
        },
      ],
    },
  });
  assert.equal(syncMismatch.status, 201);
  assert.equal(syncMismatch.data.rechazadas, 1);
  assert.equal(syncMismatch.data.resultados[0].codigo_error, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

  console.log('=== [6/6] Verificando conflicto de ultima unidad en sincronizacion offline ===');
  const syncConflict = await request('/ventas/sincronizar-offline', {
    method: 'POST',
    tenant: 'legacy',
    token: legacyToken,
    body: {
      operaciones: [
        {
          id: `OFF-CONFLICT-${Date.now()}`,
          sucursal_id: 1,
          metodo_pago: 'efectivo',
          origen: 'offline_pos',
          items: [{ variante_id: primeraVariante.id, cantidad: 9999 }],
        },
      ],
    },
  });
  assert.equal(syncConflict.status, 201);
  assert.equal(syncConflict.data.conflictos, 1);
  assert.equal(syncConflict.data.resultados[0].codigo_error, 'STOCK_CONFLICT_LAST_UNIT');

  console.log('OK: Suite smoke.mjs superada exitosamente.');
}

run().catch((err) => {
  console.error('FALLO en smoke.mjs:', err);
  process.exit(1);
});
