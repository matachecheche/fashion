/**
 * Validación offline-first de la PWA:
 *   1. manifest.webmanifest válido (nombre, iconos 192/512, display standalone)
 *   2. sw.js presente y con manejadores fetch/install/activate
 *   3. Los iconos PNG existen y tienen las dimensiones correctas (firma PNG)
 *   4. Los 192 overlays AR (-ar.png) y 192 fotos (-foto.jpg) generados existen en backend-nest/public/assets/prendas
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsLegacyFactoryNavigation } from '../src/lib/factoryResetNavigation.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let fallos = 0;
const ok = (msg) => console.log(`  ✅ ${msg}`);
const fail = (msg) => {
  fallos += 1;
  console.error(`  ❌ ${msg}`);
};

console.log('\n[1/5] Validando manifest PWA...');
try {
  const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.webmanifest'), 'utf8'));
  manifest.name && ok(`name: ${manifest.name}`);
  manifest.short_name && ok(`short_name: ${manifest.short_name}`);
  manifest.display === 'standalone' ? ok('display: standalone') : fail('display != standalone');
  const sizes = (manifest.icons || []).map((i) => i.sizes);
  for (const esperada of ['192x192', '512x512']) {
    sizes.includes(esperada) ? ok(`icono ${esperada} declarado`) : fail(`falta icono ${esperada}`);
  }
  manifest.start_url ? ok(`start_url: ${manifest.start_url}`) : fail('falta start_url');
} catch (e) {
  fail(`manifest ilegible: ${e.message}`);
}

console.log('\n[2/5] Validando Service Worker...');
try {
  const sw = readFileSync(join(root, 'public/sw.js'), 'utf8');
  for (const evt of ['install', 'activate', 'fetch']) {
    sw.includes(`'${evt}'`) || sw.includes(`"${evt}"`)
      ? ok(`handler ${evt}`)
      : fail(`falta handler ${evt}`);
  }
  // Regresión: sin runtime-cache de assets estáticos el bundle JS/CSS no se cachea
  // y la PWA abre en blanco offline.
  const tieneAssets = /js\|css/.test(sw) && sw.includes('CACHE_ASSETS');
  tieneAssets ? ok('runtime-cache de assets estáticos (JS/CSS)') : fail('falta runtime-cache de /assets/*.js|css (PWA en blanco offline)');
} catch (e) {
  fail(`sw.js ilegible: ${e.message}`);
}

console.log('\n[3/5] Validando iconos PNG...');
function validarPng(relPath, minWidth) {
  const full = join(root, relPath);
  if (!existsSync(full)) return fail(`no existe ${relPath}`);
  const buf = readFileSync(full);
  const esPng =
    buf.length > 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!esPng) return fail(`${relPath} no es un PNG válido`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  width >= minWidth && height >= minWidth
    ? ok(`${relPath} ${width}x${height}`)
    : fail(`${relPath} ${width}x${height} menor a ${minWidth}px`);
}
validarPng('public/icons/icon-192.png', 192);
validarPng('public/icons/icon-512.png', 512);

console.log('\n[4/5] Validando pipeline de 192 garment assets (foto + overlay AR)...');
const assetsDir = join(root, '..', 'backend-nest', 'public', 'assets', 'prendas');
if (!existsSync(assetsDir)) {
  fail(`no existe ${assetsDir}`);
} else {
  const files = readdirSync(assetsDir);
  const ar = files.filter((f) => f.endsWith('-ar.png'));
  const foto = files.filter((f) => f.endsWith('-foto.jpg'));
  ar.length === 96
    ? ok('96 overlays AR (8 tipos x 12 colores) presentes')
    : fail(`overlays AR: ${ar.length} (esperados 96)`);
  foto.length === 96
    ? ok('96 fotos de catálogo presentes')
    : fail(`fotos: ${foto.length} (esperadas 96)`);

  // Firma de contenido determinista: cada overlay AR debe tener transparencia (PNG con alpha)
  const muestra = ar[0];
  if (muestra) {
    const buf = readFileSync(join(assetsDir, muestra));
    const colortype = buf[25];
    colortype === 6 || colortype === 4
      ? ok('overlay AR con canal alpha (transparencia)')
      : fail(`overlay AR sin alpha (colorType=${colortype})`);
  }
}

console.log('\n[5/5] Validando destino web tras detectar reset de fábrica...');
for (const pathname of ['/tienda/legacy', '/tienda/legacy/', '/tienda/legacy/catalogo', '/TIENDA/LEGACY/checkout']) {
  !needsLegacyFactoryNavigation(pathname)
    ? ok(`se conserva la ruta legacy ${pathname}`)
    : fail(`la ruta legacy debe conservarse: ${pathname}`);
}
for (const pathname of ['/tienda/otra', '/tienda/otra/carrito', '/panel', '/panel/ventas', '/', '/catalogo', '/auth', '/ruta-inexistente']) {
  needsLegacyFactoryNavigation(pathname)
    ? ok(`${pathname} redirige al storefront de fábrica`)
    : fail(`${pathname} debe redirigir a /tienda/legacy`);
}
const appContext = readFileSync(join(root, 'src/context/App.tsx'), 'utf8');
const appMain = readFileSync(join(root, 'src/main.tsx'), 'utf8');
appContext.includes('needsLegacyFactoryNavigation(window.location.pathname)') &&
appContext.includes("navigate('/tienda/legacy', { replace: true })")
  ? ok('AppProvider navega con replace a /tienda/legacy cuando hace falta')
  : fail('AppProvider debe usar navigate(/tienda/legacy, { replace: true })');
const routerStart = appMain.indexOf('<BrowserRouter>');
const providerStart = appMain.indexOf('<AppProvider>');
const routerEnd = appMain.indexOf('</BrowserRouter>');
routerStart >= 0 && providerStart > routerStart && routerEnd > providerStart
  ? ok('AppProvider está dentro de BrowserRouter y puede navegar')
  : fail('BrowserRouter debe envolver AppProvider');

console.log('\n========================================');
if (fallos > 0) {
  console.error(`PWA OFFLINE TEST FAILED: ${fallos} problema(s)`);
  process.exit(1);
}
console.log('PWA OFFLINE TEST PASSED ✅');
