/**
 * Expo config plugin: permite HTTP (cleartext) SOLO en perfiles de desarrollo/prueba.
 *
 * - development / preview: EAS_BUILD_PROFILE distinto de "azure" (o no definido).
 *   Necesario para apuntar el APK a NestJS en http://10.0.2.2:3000 (emulador) o
 *   http://<IP-LAN>:3000 (dispositivo físico en la misma red).
 * - azure (distribución real): NO se activa cleartext. La API de producción debe ser
 *   HTTPS (Azure Container Apps / Render); Android bloquea HTTP plano por defecto.
 *
 * El perfil llega vía EAS_BUILD_PROFILE (definido por EAS Build). Si no está definido
 * (expo prebuild local), se asume desarrollo y se permite cleartext.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withApiCleartextTraffic(config) {
  const profile = (process.env.EAS_BUILD_PROFILE || 'development').toLowerCase();
  if (profile === 'azure') {
    // Producción/distribución: HTTPS obligatorio, sin cleartext.
    return config;
  }
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (application?.$) {
      application.$['android:usesCleartextTraffic'] = 'true';
    }
    return cfg;
  });
};
