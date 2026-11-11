/**
 * Suite de suscripción SaaS: Trial de 14 días, cuotas 3/1/200 y cambio sandbox
 */
import assert from 'node:assert/strict';

const BASE_URL = (process.env.API_URL || 'http://127.0.0.1:3000/api').replace(/\/+$/, '');

async function request(path, { method = 'GET', tenant = 'legacy', token = null, body = null, headers: extraHeaders = {} } = {}) {
  const headers = { Accept: 'application/json', 'X-Tenant-Slug': tenant, ...extraHeaders };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function run() {
  console.log('=== [1/4] Creando tenant Trial para probar cuotas 3 usuarios / 1 sucursal / 200 productos ===');
  const slug = `trial-quota-${Date.now().toString(36)}`;
  const registrationBody = {
    nombre_tienda: 'Boutique Trial Quotas',
    slug,
    ciudad: 'La Paz',
    nit: String(Date.now()).slice(-10),
    acepta_trial: true,
    admin_nombre: 'Admin Trial',
    admin_email: `admin@${slug}.bo`,
    admin_password: 'Fashion2026!',
  };
  const reg = await request('/tenants/registro', {
    method: 'POST',
    headers: { 'Idempotency-Key': `reg-${slug}` },
    body: registrationBody,
  });
  assert.equal(reg.status, 201);
  const token = reg.data.access_token;

  console.log('=== [2/4] Verificando /suscripcion/estado autoritativo ===');
  const estado = await request('/suscripcion/estado', { tenant: slug, token });
  assert.equal(estado.status, 200);
  assert.equal(estado.data.plan_actual, 'trial');
  assert.equal(estado.data.modo_facturacion, 'sandbox');
  assert.equal(estado.data.cobro_real_activo, false);
  assert.equal(estado.data.cuotas.usuarios.maximo, 3);
  assert.equal(estado.data.cuotas.sucursales.maximo, 1);
  assert.equal(estado.data.cuotas.productos.maximo, 200);
  assert.ok(estado.data.dias_restantes >= 13 && estado.data.dias_restantes <= 15);

  console.log('=== [3/4] Verificando que Trial impide crear una segunda sucursal ===');
  const suc2Trial = await request('/maestros/sucursales', {
    method: 'POST',
    tenant: slug,
    token,
    body: { codigo: 'SUC-02', nombre: 'Sucursal Norte', ciudad: 'La Paz', direccion: 'Av. Norte 200' },
  });
  assert.equal(suc2Trial.status, 403, 'Trial con una sucursal debe rechazar una segunda sucursal');

  console.log('=== [4/4] Verificando solicitud de cambio de plan en modo Sandbox sin cobro real ===');
  const cambio = await request('/suscripcion/cambio', {
    method: 'POST',
    tenant: slug,
    token,
    body: {
      plan_solicitado: 'profesional',
      aplicar_sandbox: true,
      contacto_nombre: 'Admin Demo',
      notas: 'Upgrade de prueba en CI',
    },
  });
  assert.equal(cambio.status, 201);
  assert.equal(cambio.data.cobro_real_ejecutado, false);
  assert.equal(cambio.data.plan_actualizado_en_sandbox, true);

  // En plan profesional se actualizan las cuotas en la misma transacción sandbox.
  const suc2Retry = await request('/maestros/sucursales', {
    method: 'POST',
    tenant: slug,
    token,
    body: { codigo: 'SUC-02', nombre: 'Sucursal Ahora Permitida', ciudad: 'La Paz', direccion: 'Av. Norte 200' },
  });
  assert.equal(suc2Retry.status, 201);
  const estadoProfesional = await request('/suscripcion/estado', { tenant: slug, token });
  assert.equal(estadoProfesional.data.plan_actual, 'profesional');
  assert.equal(estadoProfesional.data.cuotas.sucursales.maximo, 10);
  assert.equal(estadoProfesional.data.dias_restantes, null);

  console.log('OK: Suite subscription.mjs superada exitosamente.');
}

run().catch((err) => {
  console.error('FALLO en subscription.mjs:', err);
  process.exit(1);
});
