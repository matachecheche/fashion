/**
 * Integración transaccional de CU-19: QR sandbox, saga, expiración y reintento.
 * Requiere API arriba y DATABASE_URL con permisos de app_runtime (CI usa Postgres local).
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const BASE_URL = (process.env.API_URL || 'http://127.0.0.1:3000/api').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/fashionstore';

async function request(path, { method = 'GET', tenant = 'legacy', token = null, body = null } = {}) {
  const headers = { Accept: 'application/json', 'X-Tenant-Slug': tenant };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

async function run() {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    console.log('=== [1/8] Login y creación de orden QR sandbox ===');
    const login = await request('/auth/login', {
      method: 'POST', body: { email: 'admin@fashionstore.bo', password: 'Fashion2026!' },
    });
    assert.equal(login.status, 201);
    const token = login.data.access_token;
    const catalog = await request('/catalogo/productos', { token });
    assert.equal(catalog.status, 200);
    const product = catalog.data.find((item) => Array.isArray(item.variantes) && item.variantes.length > 0);
    assert.ok(product, 'El seed debe tener al menos una variante vendible');

    const sale = await request('/ventas', {
      method: 'POST', token,
      body: {
        sucursal_id: 1,
        metodo_pago: 'qr',
        origen: 'web',
        items: [{ variante_id: Number(product.variantes[0].id), cantidad: 1 }],
      },
    });
    assert.equal(sale.status, 201);
    assert.equal(sale.data.estado_pago, 'no_confirmado');
    const paymentId = Number(sale.data.pago.id);
    const paymentRef = String(sale.data.pago.referencia_externa);

    console.log('=== [2/8] Expiración y liberación idempotente de reserva ===');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_runtime');
      await client.query("SELECT set_config('app.tenant_id', 'legacy', true)");
      const updated = await client.query(
        `UPDATE public.pagos SET expira_en = NOW() - INTERVAL '1 minute'
          WHERE tenant_id = 'legacy' AND id = $1 AND estado = 'no_confirmado'`,
        [paymentId],
      );
      assert.equal(updated.rowCount, 1, 'Debe preparar el pago pendiente como vencido');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    let finalPayment = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await request('/pagos/conciliar', { method: 'POST', token });
      const fetched = await request(`/pagos/${paymentId}`, { token });
      finalPayment = fetched.data;
      if (fetched.status === 200 && finalPayment.estado === 'expirado') break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(finalPayment?.estado, 'expirado');
    const expiredSale = await request(`/ventas/${sale.data.id}`, { token });
    assert.equal(expiredSale.data.estado, 'cancelada');
    assert.equal(expiredSale.data.estado_pago, 'expirado');
    const expiredSagas = await request('/pagos/sagas', { token });
    assert.ok(expiredSagas.data.some((s) => s.operacion_id === paymentRef && s.estado === 'COMPENSADA'));

    console.log('=== [3/8] Reintento con referencia nueva y QR nuevo ===');
    const retry = await request(`/pagos/venta/${sale.data.id}/reintentar`, {
      method: 'POST', token, body: { metodo_pago: 'qr' },
    });
    assert.equal(retry.status, 201);
    assert.notEqual(retry.data.referencia_externa, paymentRef);
    assert.equal(retry.data.qr_es_sandbox, true);
    assert.match(retry.data.qr_data_url, /^data:image\/png;base64,/);

    console.log('=== [4/8] Rechazo firmado sandbox y compensación de la reserva ===');
    const rejected = await request('/pagos/sandbox/simular-webhook', {
      method: 'POST', token,
      body: {
        pago_id: retry.data.id,
        estado: 'rechazado',
        webhook_id: `WH-EXPIRY-RETRY-${Date.now()}`,
        motivo: 'Prueba de integración: rechazo tras reintento',
      },
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.data.pago.estado, 'rechazado');
    const rejectedSale = await request(`/ventas/${sale.data.id}`, { token });
    assert.equal(rejectedSale.data.estado_pago, 'rechazado');

    console.log('=== [5/8] Conciliación invocable idempotente ===');
    const reconcileReplay = await request('/pagos/conciliar', { method: 'POST', token });
    assert.equal(reconcileReplay.status, 200);
    const sagaRows = await request('/pagos/sagas', { token });
    assert.ok(sagaRows.data.some((s) => s.operacion_id === retry.data.referencia_externa && s.estado === 'COMPENSADA'));
    console.log('=== [6/8] Aprobación tardía tras expiración: no vender sin retención y exigir intervención ===');
    const lateSale = await request('/ventas', {
      method: 'POST', token,
      body: {
        sucursal_id: 1,
        metodo_pago: 'qr',
        origen: 'web',
        items: [{ variante_id: Number(product.variantes[0].id), cantidad: 1 }],
      },
    });
    assert.equal(lateSale.status, 201);
    const latePaymentId = Number(lateSale.data.pago.id);
    const lateClient = await pool.connect();
    try {
      await lateClient.query('BEGIN');
      await lateClient.query('SET LOCAL ROLE app_runtime');
      await lateClient.query("SELECT set_config('app.tenant_id', 'legacy', true)");
      const expired = await lateClient.query(
        `UPDATE public.pagos SET expira_en = NOW() - INTERVAL '1 minute'
          WHERE tenant_id = 'legacy' AND id = $1 AND estado = 'no_confirmado'`,
        [latePaymentId],
      );
      assert.equal(expired.rowCount, 1);
      await lateClient.query('COMMIT');
    } catch (error) {
      await lateClient.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      lateClient.release();
    }
    const expiredSweep = await request('/pagos/conciliar', { method: 'POST', token });
    assert.equal(expiredSweep.status, 200);
    assert.ok(expiredSweep.data.pagos_expirados >= 1);
    const webhookSecret = process.env.LIBELULA_WEBHOOK_SECRET || 'libelula_sandbox_webhook_secret_2026';
    const lateEvent = {
      event_id: `WH-LATE-APPROVAL-${Date.now()}`,
      tenant_id: 'legacy',
      tenant_slug: 'legacy',
      reference: String(lateSale.data.pago.referencia_externa),
      amount: Number(lateSale.data.pago.monto),
      currency: 'BOB',
      status: 'approved',
    };
    const lateRaw = JSON.stringify(lateEvent);
    const lateSignature = createHmac('sha256', webhookSecret).update(lateRaw).digest('hex');
    const lateResponse = await fetch(`${BASE_URL}/pagos/webhooks/libelula`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Tenant-Slug': 'legacy',
        'X-Provider-Signature': `sha256=${lateSignature}`,
      },
      body: lateRaw,
    });
    const lateBody = await lateResponse.json();
    assert.equal(lateResponse.status, 200);
    assert.equal(lateBody.pago.estado, 'aprobado_sin_venta');
    const lateSaleState = await request(`/ventas/${lateSale.data.id}`, { token });
    assert.equal(lateSaleState.status, 200);
    assert.equal(lateSaleState.data.estado, 'cancelada', 'Una confirmación tardía no debe convertir la venta vencida en pagada.');
    assert.equal(lateSaleState.data.estado_pago, 'aprobado_sin_venta');
    const lateSagas = await request('/pagos/sagas', { token });
    assert.ok(lateSagas.data.some((s) => s.operacion_id === lateSale.data.pago.referencia_externa && s.estado === 'REQUIERE_INTERVENCION'));

    console.log('=== [7/8] Reembolso de la excepción sandbox, auditado e idempotente ===');
    const refund = await request(`/pagos/${latePaymentId}/reembolsar-sandbox`, {
      method: 'POST', token,
      body: { motivo: 'Prueba de integración: aprobación tardía sin venta' },
    });
    assert.equal(refund.status, 200);
    assert.equal(refund.data.modo, 'sandbox_simulado');
    assert.equal(refund.data.cobro_real, false);
    assert.equal(refund.data.pago.estado, 'reembolsado');
    const refundReplay = await request(`/pagos/${latePaymentId}/reembolsar-sandbox`, {
      method: 'POST', token,
      body: { motivo: 'Replay de reembolso' },
    });
    assert.equal(refundReplay.status, 200);
    assert.equal(refundReplay.data.idempotent_replay, true);
    const refundedSale = await request(`/ventas/${lateSale.data.id}`, { token });
    assert.equal(refundedSale.data.estado, 'cancelada');
    assert.equal(refundedSale.data.estado_pago, 'reembolsado');
    const refundedSagas = await request('/pagos/sagas', { token });
    assert.ok(refundedSagas.data.some((s) => s.operacion_id === lateSale.data.pago.referencia_externa && s.estado === 'COMPENSADA'));

    console.log('=== [8/8] Devolución completa repone stock y registra pago/saga en sandbox ===');
    const returnSale = await request('/ventas', {
      method: 'POST', token,
      body: {
        sucursal_id: 1,
        metodo_pago: 'qr',
        origen: 'web',
        items: [{ variante_id: Number(product.variantes[0].id), cantidad: 1 }],
      },
    });
    assert.equal(returnSale.status, 201);
    const returnPayment = await request(`/pagos/${Number(returnSale.data.pago.id)}/aprobar-sandbox`, {
      method: 'POST', token,
      body: { webhook_id: `WH-RETURN-${Date.now()}` },
    });
    assert.equal(returnPayment.status, 201);
    assert.equal(returnPayment.data.pago.estado, 'aprobado');
    const returned = await request(`/ventas/${Number(returnSale.data.id)}/devolucion`, {
      method: 'POST', token,
      body: { motivo: 'Prueba de integración: devolución total sandbox' },
    });
    assert.equal(returned.status, 201);
    assert.equal(returned.data.modo_reembolso, 'sandbox_simulado');
    assert.equal(returned.data.cobro_real_ejecutado, false);
    const returnPaymentFinal = await request(`/pagos/${Number(returnSale.data.pago.id)}`, { token });
    assert.equal(returnPaymentFinal.data.estado, 'reembolsado');
    const returnSaleFinal = await request(`/ventas/${Number(returnSale.data.id)}`, { token });
    assert.equal(returnSaleFinal.data.estado, 'reembolsada');
    assert.equal(returnSaleFinal.data.estado_pago, 'reembolsado');
    const returnSagas = await request('/pagos/sagas', { token });
    assert.ok(returnSagas.data.some((s) => s.operacion_id === returnSale.data.pago.referencia_externa && s.estado === 'COMPENSADA'));

    console.log('OK: payments-saga.mjs superada.');
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('FALLO en payments-saga.mjs:', error);
  process.exit(1);
});
