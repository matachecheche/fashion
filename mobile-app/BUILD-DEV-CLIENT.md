# BUILD-DEV-CLIENT — FashionStore Mobile (Expo SDK 54)

## Desarrollo local (recomendado)

```bash
npm ci --legacy-peer-deps
npm run typecheck
npm start                # Metro bundler; abre Expo Go
```

- Emulador Android: `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api` (ya viene en `.env.example`).
- Dispositivo físico: usa `http://<IP-LAN-de-tu-PC>:3000/api` (misma red Wi-Fi).
- `npm run export:android` genera el bundle JS estático (verificación de build, **no** firma el APK).

## APK instalable con EAS (requiere cuenta EAS real)

```bash
npm install -g eas-cli
eas login               # abre el navegador; NO compartas tu contraseña
eas init                # enlaza el proyecto y asigna el projectId a app.json
./build-apk.bat preview # o: bash build-apk.sh preview / ./build-apk.ps1 preview
```

- El perfil `azure` genera **APK** (no AAB) con `distribution: internal`.
- `generar-apk-azure.bat` valida `/api/health` antes de compilar, guarda la URL pública
  (EXPO_PUBLIC_API_URL, no es secreto) en el entorno EAS `production` y dispara el build.
- El script descarga el APK a `mobile-app/builds/`, valida que no sea 0 bytes y calcula SHA-256.
- Si EAS Free agotó su cuota, el build fallará visiblemente: no se cambia a un plan de pago
  automáticamente. Alternativa: build local con Android SDK (`cd android && ./gradlew assembleRelease`)
  tras `npx expo prebuild`, documentado en `docs/APK.md`.

## Qué NO hace este pipeline

- No crea cuentas, no paga suscripciones, no cambia planes de pago.
- No inserta secretos en el repositorio ni en el bundle (solo variables `EXPO_PUBLIC_*`, públicas por diseño).
- No afirma que el APK "funciona" sin instalar y probar en Android real o emulador.

## Checklist de verificación en dispositivo

1. Instalar el APK (`adb install builds/*.apk` o tocando el archivo).
2. Permitir cámara → Probador AR muestra la vista previa y el overlay.
3. Iniciar sesión con una tienda (p. ej. `/tienda/legacy`).
4. Modo avión → agregar venta (POS) → ver cola "pendiente" en Cuenta.
5. Reconectar → "Sincronizar cola" → estados actualizados sin duplicar operaciones.
