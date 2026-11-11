/**
 * Integración real del ciclo de ML demo por tenant.
 * Requiere NestJS + FastAPI + PostgreSQL con schema, migraciones y seed.
 * Los modelos/predicciones son sintéticos y no deben activar decisiones comerciales.
 */
import assert from 'node:assert/strict';

const BASE_URL = (process.env.API_URL || 'http://127.0.0.1:3000/api').replace(/\/+$/, '');

async function request(path, { method = 'GET', tenant = 'legacy', token = null, body = null, headers: extraHeaders = {} } = {}) {
  const headers = { Accept: 'application/json', 'X-Tenant-Slug': tenant, ...extraHeaders };
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

function maxVersionsByAlgorithm(models) {
  const versions = new Map();
  for (const model of models) {
    const algorithm = String(model.algoritmo);
    versions.set(algorithm, Math.max(versions.get(algorithm) || 0, Number(model.version)));
  }
  return versions;
}

async function run() {
  console.log('=== [1/5] Login admin y comprobación de modelos iniciales tenant-scoped ===');
  const login = await request('/auth/login', {
    method: 'POST',
    body: { email: 'admin@fashionstore.bo', password: 'Fashion2026!' },
  });
  assert.equal(login.status, 201);
  const token = login.data.access_token;
  const modelsBefore = await request('/ia/ml/modelos?limit=200', { token });
  assert.equal(modelsBefore.status, 200, JSON.stringify(modelsBefore.data));
  assert.ok(modelsBefore.data.tenant_id !== undefined && modelsBefore.data.tenant_id !== null);
  const requiredAlgorithms = new Set([
    'propension_compra_logistica',
    'riesgo_quiebre_logistica',
    'segmentacion_clientes_kmeans',
  ]);
  const seededAlgorithms = new Set(modelsBefore.data.modelos.map((model) => model.algoritmo));
  for (const algorithm of requiredAlgorithms) {
    assert.ok(seededAlgorithms.has(algorithm), `falta modelo sintético de fábrica: ${algorithm}`);
  }
  const previousVersions = maxVersionsByAlgorithm(modelsBefore.data.modelos);
  const predictionsBefore = await request('/ia/ml/predicciones?limit=200', { token });
  assert.equal(predictionsBefore.status, 200, JSON.stringify(predictionsBefore.data));
  assert.ok(predictionsBefore.data.predicciones.length >= 3, 'el factory seed debe mostrar predicciones ML iniciales');
  assert.ok(predictionsBefore.data.predicciones.every((row) => row.es_sintetico === true));

  console.log('=== [2/5] Entrenar y persistir tres artefactos sintéticos en PostgreSQL ===');
  const trained = await request('/ia/ml/entrenar', {
    method: 'POST', token,
    body: { seed: 8264 },
  });
  assert.equal(trained.status, 201, JSON.stringify(trained.data));
  assert.equal(trained.data.tenant_slug, 'legacy');
  assert.equal(trained.data.es_dataset_sintetico, true);
  const algorithms = new Set(trained.data.modelos_persistidos.map((model) => model.algoritmo));
  assert.deepEqual(algorithms, new Set([
    'propension_compra_logistica',
    'riesgo_quiebre_logistica',
    'segmentacion_clientes_kmeans',
  ]));
  for (const model of trained.data.modelos_persistidos) {
    assert.equal(Number(model.version), (previousVersions.get(model.algoritmo) || 0) + 1);
    assert.equal(model.estado, 'APROBADO');
    assert.equal(model.metricas.es_dataset_sintetico, true);
  }

  console.log('=== [3/5] Predicciones demo persistidas y segunda versión monotónica ===');
  const secondTraining = await request('/ia/ml/entrenar', {
    method: 'POST', token,
    body: { seed: 8265 },
  });
  assert.equal(secondTraining.status, 201, JSON.stringify(secondTraining.data));
  const firstVersionByAlgorithm = new Map(trained.data.modelos_persistidos.map((model) => [model.algoritmo, Number(model.version)]));
  for (const model of secondTraining.data.modelos_persistidos) {
    assert.equal(Number(model.version), firstVersionByAlgorithm.get(model.algoritmo) + 1);
  }
  const prediction = await request('/ia/ml/predecir-demo', {
    method: 'POST', token,
    body: { seed: 42 },
  });
  assert.equal(prediction.status, 201, JSON.stringify(prediction.data));
  assert.equal(prediction.data.tenant_slug, 'legacy');
  assert.equal(prediction.data.es_dataset_sintetico, true);
  assert.equal(prediction.data.predicciones_persistidas.length, 3);
  assert.ok(prediction.data.segmento_persistido_id > 0);
  assert.ok(prediction.data.predicciones_persistidas.every((row) => row.es_sintetico));
  const predictionsAfter = await request('/ia/ml/predicciones?limit=200', { token });
  assert.equal(predictionsAfter.status, 200);
  assert.ok(predictionsAfter.data.tenant_id !== undefined && predictionsAfter.data.tenant_id !== null);
  const predictionIds = new Set(prediction.data.predicciones_persistidas.map((row) => Number(row.id)));
  assert.ok(predictionIds.size === 3);
  assert.ok(predictionsAfter.data.predicciones.filter((row) => predictionIds.has(Number(row.id))).length === 3);

  console.log('=== [4/5] Tenant nuevo no hereda modelos/predicciones de legacy ===');
  const slug = `ml-tenant-${Date.now().toString(36)}`;
  const registration = await request('/tenants/registro', {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': `reg-${slug}` },
    body: {
      nombre_tienda: 'Boutique ML Tenant Isolation',
      slug,
      ciudad: 'Santa Cruz',
      nit: String(Date.now()).slice(-10),
      acepta_trial: true,
      admin_nombre: 'Admin ML Isolation',
      admin_email: `admin@${slug}.bo`,
      admin_password: 'Fashion2026!',
    },
  });
  assert.equal(registration.status, 201, JSON.stringify(registration.data));
  const tenantId = String(registration.data.tenant.id);
  const newTenantModels = await request('/ia/ml/modelos?limit=200', {
    tenant: slug,
    token: registration.data.access_token,
  });
  assert.equal(newTenantModels.status, 200, JSON.stringify(newTenantModels.data));
  assert.equal(newTenantModels.data.tenant_id, tenantId);
  assert.deepEqual(newTenantModels.data.modelos, []);
  const newTenantPredictions = await request('/ia/ml/predicciones?limit=200', {
    tenant: slug,
    token: registration.data.access_token,
  });
  assert.equal(newTenantPredictions.status, 200);
  assert.equal(newTenantPredictions.data.tenant_id, tenantId);
  assert.deepEqual(newTenantPredictions.data.predicciones, []);

  console.log('=== [5/5] Token legacy no puede consultar el otro tenant ===');
  const crossTenantAttempt = await request('/ia/ml/modelos', { tenant: slug, token });
  assert.equal(crossTenantAttempt.status, 403);
  console.log('OK: ml-persistence.mjs superada.');
}

run().catch((error) => {
  console.error('FALLO en ml-persistence.mjs:', error);
  process.exit(1);
});
