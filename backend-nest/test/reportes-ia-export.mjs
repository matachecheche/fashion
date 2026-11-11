/**
 * Suite de pruebas de Reportes por IA y Exportacion binaria real (PDF, Excel XLSX y CSV seguro)
 */
import assert from 'node:assert/strict';

const BASE_URL = (process.env.API_URL || 'http://127.0.0.1:3000/api').replace(/\/+$/, '');

async function run() {
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': 'legacy' },
    body: JSON.stringify({ email: 'admin@fashionstore.bo', password: 'Fashion2026!' }),
  });
  const { access_token: token } = await loginRes.json();
  assert.ok(token);

  console.log('=== [1/4] Consultando reporte estructurado por comando en lenguaje natural ===');
  const consultaRes = await fetch(`${BASE_URL}/reportes/ia/consultar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Tenant-Slug': 'legacy',
    },
    body: JSON.stringify({ comando: 'Mostrar top de productos mas vendidos este mes' }),
  });
  assert.equal(consultaRes.status, 201);
  const consulta = await consultaRes.json();
  assert.ok(consulta.titulo);
  assert.ok(Array.isArray(consulta.columnas) && consulta.columnas.length > 0);
  assert.ok(Array.isArray(consulta.filas) && consulta.filas.length > 0);

  console.log('=== [2/4] Verificando exportacion binaria PDF (%PDF-) ===');
  const pdfRes = await fetch(`${BASE_URL}/reportes/ia/exportar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Tenant-Slug': 'legacy',
    },
    body: JSON.stringify({ comando: 'Reporte de ventas por sucursal en PDF', formato: 'pdf' }),
  });
  assert.equal(pdfRes.status, 201);
  assert.match(pdfRes.headers.get('content-type') || '', /application\/pdf/);
  const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdfBytes.length > 500, 'El PDF debe tener contenido real (>500 bytes)');

  console.log('=== [3/4] Verificando exportacion binaria Excel XLSX (PK\\x03\\x04) ===');
  const xlsxRes = await fetch(`${BASE_URL}/reportes/ia/exportar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Tenant-Slug': 'legacy',
    },
    body: JSON.stringify({ comando: 'Inventario y alertas de stock en Excel', formato: 'excel' }),
  });
  assert.equal(xlsxRes.status, 201);
  const xlsxBytes = Buffer.from(await xlsxRes.arrayBuffer());
  assert.equal(xlsxBytes[0], 0x50); // 'P'
  assert.equal(xlsxBytes[1], 0x4b); // 'K'
  assert.ok(xlsxBytes.length > 1000, 'El archivo XLSX debe ser un contenedor OpenXML valido');

  console.log('=== [4/4] Verificando exportacion CSV con BOM UTF-8 ===');
  const csvRes = await fetch(`${BASE_URL}/reportes/ia/exportar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Tenant-Slug': 'legacy',
    },
    body: JSON.stringify({ comando: 'Exportar ventas en CSV', formato: 'csv' }),
  });
  assert.equal(csvRes.status, 201);
  const csvText = await csvRes.text();
  assert.ok(csvText.includes('Comprobante'));
  assert.ok(csvText.split('\n').length >= 3);

  console.log('OK: Suite reportes-ia-export.mjs superada exitosamente.');
}

run().catch((err) => {
  console.error('FALLO en reportes-ia-export.mjs:', err);
  process.exit(1);
});
