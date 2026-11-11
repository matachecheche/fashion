/**
 * Prueba de integración de resolución durable de conflictos POS offline.
 * Requiere API Nest arriba y PostgreSQL inicializado con migraciones + seed.
 */
import assert from 'node:assert/strict';

const BASE_URL = (process.env.API_URL || 'http://127.0.0.1:3000/api').replace(/\/+$/, '');

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
  const login = await request('/auth/login', {
    method: 'POST',
    body: { email: 'admin@fashionstore.bo', password: 'Fashion2026!' },
  });
  assert.equal(login.status, 201);
  const token = login.data.access_token;
  const catalog = await request('/catalogo/productos', { token });
  assert.equal(catalog.status, 200);
  const variant = catalog.data.find((product) => product.variantes?.length)?.variantes[0];
  assert.ok(variant, 'El seed debe contener al menos una variante');

  console.log('=== [1/4] Conflicto por stock insuficiente queda durable ===');
  const retryId = `SYNC-RETRY-${Date.now()}`;
  const conflict = await request('/ventas/sincronizar-offline', {
    method: 'POST', token,
    body: {
      operaciones: [{
        id: retryId,
        sucursal_id: 1,
        metodo_pago: 'efectivo',
        origen: 'offline_pos',
        items: [{ variante_id: Number(variant.id), cantidad: 9999 }],
      }],
    },
  });
  assert.equal(conflict.status, 201);
  assert.equal(conflict.data.conflictos, 1);
  assert.equal(conflict.data.resultados[0].codigo_error, 'STOCK_CONFLICT_LAST_UNIT');

  console.log('=== [2/4] Reponer inventario por el flujo auditable y reintentar una sola venta ===');
  const inventory = await request('/inventario?sucursal_id=1', { token });
  assert.equal(inventory.status, 200);
  const stockRow = inventory.data.find((row) => Number(row.variante_id) === Number(variant.id));
  assert.ok(stockRow?.almacen_id, 'Debe existir almacén de la variante en la sucursal');
  const receipt = await request('/inventario/movimientos', {
    method: 'POST', token,
    body: {
      almacen_id: Number(stockRow.almacen_id),
      variante_id: Number(variant.id),
      tipo: 'entrada',
      cantidad: 9999,
      motivo: `Preparación de prueba de reintento offline ${retryId}`,
    },
  });
  assert.equal(receipt.status, 201);

  const retry = await request('/sync/resolver-conflicto', {
    method: 'POST', token,
    body: { operacion_id: retryId, accion: 'reintentar' },
  });
  assert.equal(retry.status, 201);
  assert.equal(retry.data.estado, 'sincronizada');
  assert.ok(retry.data.venta?.id);
  assert.equal(retry.data.venta.estado, 'pagada');
  const operationsAfterRetry = await request('/sync/operaciones', { token });
  const resolved = operationsAfterRetry.data.find((row) => row.id === retryId);
  assert.equal(resolved.estado, 'sincronizada');
  assert.equal(resolved.estado_resolucion, 'RESUELTO');

  console.log('=== [3/4] Replay de la resolución no crea una segunda venta ===');
  const replay = await request('/sync/resolver-conflicto', {
    method: 'POST', token,
    body: { operacion_id: retryId, accion: 'reintentar' },
  });
  assert.equal(replay.status, 409, 'Una operación ya sincronizada no debe reintentarse como conflicto.');
  const replayedOperations = await request('/sync/operaciones', { token });
  const salesForOperation = replayedOperations.data.filter((row) => row.id === retryId);
  assert.equal(salesForOperation.length, 1);

  console.log('=== [4/4] Descartar otro conflicto deja auditoría y lo quita de la bandeja ===');
  const discardId = `SYNC-DISCARD-${Date.now()}`;
  const secondConflict = await request('/ventas/sincronizar-offline', {
    method: 'POST', token,
    body: {
      operaciones: [{
        id: discardId,
        sucursal_id: 1,
        metodo_pago: 'efectivo',
        origen: 'offline_pos',
        items: [{ variante_id: Number(variant.id), cantidad: 999999 }],
      }],
    },
  });
  assert.equal(secondConflict.status, 201);
  assert.equal(secondConflict.data.conflictos, 1);
  const discarded = await request('/sync/resolver-conflicto', {
    method: 'POST', token,
    body: { operacion_id: discardId, accion: 'descartar', nota_resolucion: 'Descartada por prueba de integración.' },
  });
  assert.equal(discarded.status, 201);
  assert.equal(discarded.data.estado, 'rechazada');
  const operationsAfterDiscard = await request('/sync/operaciones', { token });
  const discardedRow = operationsAfterDiscard.data.find((row) => row.id === discardId);
  assert.equal(discardedRow.estado_resolucion, 'DESCARTADO');

  console.log('OK: sync-conflicts.mjs superada.');
}

run().catch((error) => {
  console.error('FALLO en sync-conflicts.mjs:', error);
  process.exit(1);
});
