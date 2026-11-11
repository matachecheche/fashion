# APK — Pasos reales y límites

Este documento existe para evitar falsas promesas. **No existe un APK instalable hasta
completar los pasos 1–5 y el build en EAS termina con éxito.**

## Qué ya está listo en el repo

- Proyecto Expo SDK 54 completo (`mobile-app/`), `tsc --noEmit` limpio, `expo doctor` 18/18.
- `app.json`: package `bo.fashionstore.app`, `versionCode 20`, scheme `fashionstore`,
  iconos/splash presentes, `extra.eas.projectId` **deliberadamente ausente** (lo asigna `eas init`).
- `eas.json` con perfiles `development`, `preview` y `azure` (este último apuntando al perfil
  internal distribution para pruebas privadas). `EXPO_PUBLIC_API_URL` de producción se fija
  **por entorno EAS** (`eas env:create`), nunca como secreto en Git.
- Scripts multiplataforma: `mobile-app/build-apk.bat|ps1|sh` (instalan deps, typecheck,
  compilan, descargan el APK a `builds/`, validan tamaño > 0 y calculan SHA-256).
- `mobile-app/generar-apk-azure.bat`: valida `/api/health` de la API pública HTTPS **antes** de compilar; si no es saludable se detiene. El script de compatibilidad `generar-apk-render.bat` delega en este mismo flujo Azure + Neon.

## Pasos para un APK real (Azure Container Apps)

1. **Desplegar la API** con `desplegar-azure.bat` y seguir `docs/DESPLIEGUE-AZURE.md`.
   El BAT inicia sesión Azure CLI si hace falta; tú creas una base Neon vacía en el navegador
   y pegas su URL directa en el prompt local oculto. Tras tu confirmación, el asistente aplica
   schema/migraciones/seed, crea el rol runtime, cambia la contraseña demo y configura NestJS,
   FastAPI interno y la web. Puede consumir crédito Azure; no garantiza costo cero. Este flujo
   todavía debe ejecutarse desde una cuenta real para validar un despliegue cloud.
2. `curl https://<tu-fqdn>/api/health` → debe responder `{"estado":"ok"}`.
3. En `mobile-app/`: `npm install -g eas-cli && eas login` (tu cuenta; nunca compartas credenciales).
4. `eas init` (asigna `projectId` a `app.json`).
5. Fija la URL pública de la API:
   `eas env:create --environment production --name EXPO_PUBLIC_API_URL --value "https://<tu-fqdn>/api" --visibility plaintext`
6. Compila: `build-apk.bat azure` (o `bash build-apk.sh azure`). Tarda minutos; EAS cobra
   según su plan (hay cuota gratuita limitada). **Si la cuota se agota, el build falla visiblemente;
   no se cambia a un plan de pago automáticamente.**
7. Instala el APK resultante: `adb install builds/FashionStore-azure-*.apk`.

## Límites y advertencias

- El APK de `preview`/`azure` apunta a `EXPO_PUBLIC_API_URL` de **ese perfil** en el momento
  del build; cambiar la URL después exige recompilar (la URL va embebida en el bundle).
- El Probador AR usa la cámara del teléfono; `takePictureAsync` captura la foto sin el overlay
  AR compuesto (el overlay es una vista encima del video). El botón "Guardar look" guarda la
  foto cruda en el dispositivo; no mezcles el overlay sin revisión de calidad.
- El seguimiento MediaPipe es **opcional (beta)** dentro de un WebView y nunca es requisito
  del flujo AR principal.
- Este repo no garantiza que Google Play acepte el paquete; la ficha, política de privacidad
  y firma (keystore propio) son responsabilidad del publicador.
