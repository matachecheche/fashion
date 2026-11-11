# BUILD-DEV-CLIENT — FashionStore Mobile (Expo SDK 54)

## Desarrollo local

```bash
npm ci --legacy-peer-deps
npm run typecheck
npm start
```

- Emulador Android: `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api`.
- Dispositivo físico: usa `http://<IP-LAN-de-tu-PC>:3000/api` en la misma red.
- `npm run export:android` genera el bundle JS estático; **no es un APK instalable**.

## APK en Azure (recomendado)

La compilación real en nube Azure usa el pipeline `/azure-pipelines-apk.yml` del repositorio. Consulta [`docs/APK-AZURE.md`](../docs/APK-AZURE.md). La primera configuración crea una vez el pipeline y el grupo de variables `fashionstore-mobile` con `EXPO_PUBLIC_API_URL`; después basta pulsar **Run pipeline** y descargar el artefacto `FashionStore-APK`.

El pipeline valida la API, TypeScript, Expo Prebuild, Gradle, integridad ZIP y firma del APK. Produce un APK `debug` para pruebas internas. La clave debug del agente es temporal, así que no ofrece identidad de firma estable entre builds; para distribución y actualizaciones se debe configurar un keystore privado como Secure File y compilar un perfil release.

## Alternativa EAS

```bash
npm install -g eas-cli
eas login
eas init
./build-apk.bat preview
```

`generar-apk-azure.bat` valida la API pública y luego dispara EAS Build; pese a su nombre histórico, ese script no compila dentro de Azure Pipelines. EAS compila en infraestructura de Expo.

## Pruebas en un dispositivo Android

1. Instala el APK descargado desde el artefacto Azure.
2. Comprueba inicio de sesión y navegación según rol/tienda.
3. Prueba catálogo, caja, ventas, reservas e inventario.
4. Prueba modo avión y sincronización posterior, sin duplicar operaciones.
5. Prueba cámara/vestidor AR y dictado con los permisos del dispositivo.
6. En Reportes IA & ML comprueba que las métricas aparezcan como indicadores y tablas, no como JSON.

No declares la app validada en dispositivo hasta completar estas comprobaciones reales.
