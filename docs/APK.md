# APK — compilación y publicación

FashionStore ofrece dos rutas de compilación Android. **Para generar el APK dentro de Azure usa Azure Pipelines**, no `Azure Container Apps`: Container Apps aloja los servicios web/API, mientras que Azure Pipelines ejecuta el proceso temporal de Gradle.

## Opción recomendada: compilar el APK en Azure Pipelines

Sigue [`docs/APK-AZURE.md`](APK-AZURE.md). El archivo `azure-pipelines-apk.yml` configura una compilación cloud que:

1. Lee `EXPO_PUBLIC_API_URL` del grupo de variables `fashionstore-mobile`.
2. Comprueba que el endpoint HTTPS `/api/health` responda `estado=ok`.
3. Instala dependencias, valida TypeScript y ejecuta Expo Prebuild.
4. Compila el APK Android con Gradle (`:app:assembleDebug`).
5. Verifica la firma y la integridad del APK y publica el artefacto `FashionStore-APK`.

La configuración de Azure DevOps se hace una sola vez. En posteriores builds solo se ejecuta el pipeline. El artefacto es un APK `debug` para pruebas internas, no una distribución de Google Play. La firma debug es efímera en el agente; para actualizaciones estables o distribución pública se necesita un keystore propio y un perfil `release` protegido.

## Alternativa: Expo Application Services (EAS)

Los scripts `mobile-app/build-apk.bat`, `build-apk.ps1` y `build-apk.sh` siguen usando EAS Build, que compila en la infraestructura de Expo, no en Azure. `mobile-app/generar-apk-azure.bat` es un lanzador de compatibilidad que comprueba la API de Azure y luego ejecuta EAS; su nombre histórico no significa que Gradle se ejecute en Azure.

## ¿Debo volver a desplegar por cambios visuales?

Las correcciones de presentación de ML se realizan en `frontend-web` y `mobile-app`; no modifican el esquema PostgreSQL ni las migraciones. Por tanto:

- **Web:** publica una nueva imagen `fashionstore-web` en GHCR y actualiza la Container App web para que la interfaz corregida quede en producción.
- **Android:** ejecuta el pipeline de Azure para producir un APK nuevo e instala ese APK en el dispositivo.
- **Neon:** no restaures la base, no vuelvas a aplicar `seed.sql` y no ejecutes `RESTABLECER-DEMO` por estos cambios de interfaz.
- **Backend/API:** no requiere reconstrucción por esta corrección visual concreta, salvo que tu despliegue actual tenga otras modificaciones pendientes.

## Limitaciones de verificación

Un pipeline YAML y las comprobaciones locales no acreditan por sí solos un APK compilado e instalado. La compilación cloud real requiere que el propietario conecte el repositorio GitHub y configure el grupo de variables en Azure DevOps; después hay que ejecutar el pipeline e instalar el artefacto en un dispositivo/emulador Android.
