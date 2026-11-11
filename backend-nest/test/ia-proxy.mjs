/**
 * Suite de pruebas del Proxy IA NestJS -> FastAPI con propagacion de Tenant y metricas ML
 */
import assert from 'node:assert/strict';

const BASE_URL = (process.env.API_URL || 'http://127.0.0.1:3000/api').replace(/\/+$/, '');

async function run() {
  console.log('=== [1/4] Verificando estado del motor IA via proxy NestJS ===');
  const estRes = await fetch(`${BASE_URL}/ia/estado`, {
    headers: { 'X-Tenant-Slug': 'legacy' },
  });
  assert.equal(estRes.status, 200);
  const est = await estRes.json();
  assert.equal(est.tenant_slug, 'legacy');
  assert.ok(['local', 'generativo', 'groq'].includes(est.modo));

  console.log('=== [2/4] Verificando chat del asistente virtual acotado al tenant ===');
  const chatRes = await fetch(`${BASE_URL}/ia/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': 'legacy' },
    body: JSON.stringify({ mensaje: 'Busco un vestido elegante para fiesta' }),
  });
  assert.equal(chatRes.status, 201);
  const chat = await chatRes.json();
  assert.equal(chat.tenant_slug, 'legacy');
  assert.ok(chat.respuesta.length > 15);
  assert.ok(Array.isArray(chat.sugerencias));

  console.log('=== [3/4] Verificando sugerencia antropometrica de talla y calibracion AR ===');
  const tallaRes = await fetch(`${BASE_URL}/ia/talla`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': 'legacy' },
    body: JSON.stringify({ altura_cm: 170, peso_kg: 66, tipo_prenda: 'vestido', preferencia_ajuste: 'regular' }),
  });
  assert.equal(tallaRes.status, 201);
  const talla = await tallaRes.json();
  assert.ok(['XS', 'S', 'M', 'L', 'XL'].includes(talla.talla_sugerida));

  console.log('=== [4/4] Verificando metricas ML reales en holdout via proxy ===');
  const mlRes = await fetch(`${BASE_URL}/ia/ml/metricas?seed=2026`, {
    headers: { 'X-Tenant-Slug': 'legacy' },
  });
  assert.equal(mlRes.status, 200);
  const ml = await mlRes.json();
  assert.ok(ml.modelos.propension_compra.holdout_metrics.f1 > 0.8);
  assert.ok(ml.modelos.riesgo_quiebre_stock.holdout_metrics.f1 > 0.8);
  assert.equal(ml.modelos.segmentacion_clientes.k_seleccionado, 3);

  console.log('OK: Suite ia-proxy.mjs superada exitosamente.');
}

run().catch((err) => {
  console.error('FALLO en ia-proxy.mjs:', err);
  process.exit(1);
});
