/**
 * Suite de pruebas del protocolo de sincronizacion incremental (/api/sync/pull)
 */
import assert from 'node:assert/strict';

const BASE_URL = (process.env.API_URL || 'http://127.0.0.1:3000/api').replace(/\/+$/, '');

async function request(path, { method = 'GET', tenant = 'legacy', token = null, body = null } = {}) {
  const headers = { Accept: 'application/json', 'X-Tenant-Slug': tenant };
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
  console.log('=== [1/3] Pull inicial con cursor=0 devuelve snapshot completo ===');
  const pull0 = await request('/sync/pull?cursor=0&limit=50', { tenant: 'legacy' });
  assert.equal(pull0.status, 200);
  assert.ok(pull0.data.snapshot, 'Cursor 0 debe incluir snapshot completo');
  assert.ok(pull0.data.snapshot.productos.length >= 8);
  assert.ok(pull0.data.snapshot.variantes.length >= 24);
  let cursorInicial = pull0.data.next_cursor;
  assert.ok(cursorInicial >= 0);
  // El seed de fábrica puede producir más de una página de eventos del catálogo.
  // Drenar el snapshot incremental inicial para que la siguiente lectura mida solo
  // la mutación hecha por esta prueba, sin confundirla con el feed sembrado.
  let quedanCambios = Boolean(pull0.data.has_more);
  while (quedanCambios) {
    const pagina = await request(`/sync/pull?cursor=${cursorInicial}&limit=500`, { tenant: 'legacy' });
    assert.equal(pagina.status, 200);
    assert.ok(pagina.data.cambios.length > 0, 'has_more debe acompañarse de eventos');
    cursorInicial = pagina.data.next_cursor;
    quedanCambios = Boolean(pagina.data.has_more);
  }

  console.log('=== [2/3] Mutar un producto genera evento incremental en /sync/pull ===');
  const login = await request('/auth/login', {
    method: 'POST',
    tenant: 'legacy',
    body: { email: 'admin@fashionstore.bo', password: 'Fashion2026!' },
  });
  const token = login.data.access_token;

  const prod = pull0.data.snapshot.productos[0];
  const nuevoPrecio = Number(prod.precio_base) + 1;
  const patchRes = await request(`/catalogo/productos/${prod.id}`, {
    method: 'PATCH',
    tenant: 'legacy',
    token,
    body: { precio_base: nuevoPrecio },
  });
  assert.equal(patchRes.status, 200);

  const pullDelta = await request(`/sync/pull?cursor=${cursorInicial}&limit=50`, { tenant: 'legacy' });
  assert.equal(pullDelta.status, 200);
  assert.equal(pullDelta.data.snapshot, null, 'Cursor > 0 solo debe enviar deltas sin snapshot pesado');
  assert.ok(pullDelta.data.cambios.length >= 1, 'Debe aparecer al menos 1 evento en el feed incremental');
  assert.ok(pullDelta.data.next_cursor > cursorInicial, 'El cursor debe avanzar monotonicamente');

  // Restaurar precio original
  await request(`/catalogo/productos/${prod.id}`, {
    method: 'PATCH',
    tenant: 'legacy',
    token,
    body: { precio_base: prod.precio_base },
  });

  console.log('=== [3/3] Pull subsiguiente sin cambios devuelve 0 eventos ===');
  const pullVacio = await request(`/sync/pull?cursor=${pullDelta.data.next_cursor + 10}`, {
    tenant: 'legacy',
  });
  assert.equal(pullVacio.status, 200);
  assert.equal(pullVacio.data.cambios.length, 0);

  console.log('OK: Suite sync-pull.mjs superada exitosamente.');
}

run().catch((err) => {
  console.error('FALLO en sync-pull.mjs:', err);
  process.exit(1);
});
