# APK Android autónomo de FashionStore en Azure Pipelines

El pipeline de este repositorio genera un **APK de la variante RELEASE** en un agente Microsoft-hosted `ubuntu-24.04`. No genera un development client ni un `assembleDebug` que dependa de Metro. Expo realiza el prebuild y Gradle incorpora el bundle JavaScript al APK mediante `:app:assembleRelease`.

## Qué genera

- Archivo `.apk` instalable directamente en un teléfono Android.
- Variante Android `release`, con `assets/index.android.bundle` incluido; no necesita Metro ni una PC para servir JavaScript.
- `applicationId` esperado: `bo.fashionstore.app`.
- URL de NestJS Azure incorporada en el bundle desde `EXPO_PUBLIC_API_URL`.
- APK firmado para pruebas internas con una clave de CI temporal. No es la clave de firma estable para Google Play.
- Artefacto Azure Pipelines llamado `FashionStore-APK`, con el APK y `INFORMACION-BUILD.txt` (commit, versión, tamaño y SHA-256).

## Configuración única en Azure DevOps Services

1. Sube el proyecto completo a GitHub, incluyendo `azure-pipelines-apk.yml` y `mobile-app/ci/build-azure-apk.sh`.
2. En Azure DevOps Services, crea o abre un proyecto.
3. En **Pipelines → Library → Variable groups → Add**, crea el grupo `fashionstore-mobile`.
4. Agrega `EXPO_PUBLIC_API_URL` como variable no secreta, con la URL pública HTTPS del backend NestJS terminada en `/api`, por ejemplo `https://<tu-api>.azurecontainerapps.io/api`. Autoriza el uso del grupo por el pipeline.
5. En **Pipelines → New pipeline**, conecta el repositorio GitHub y elige **Existing Azure Pipelines YAML file**: `/azure-pipelines-apk.yml`.
6. Guarda el pipeline. La variable de URL se configura una sola vez; las ejecuciones siguientes solo requieren pulsar **Run pipeline**.

> `PublishPipelineArtifact@1` requiere Azure DevOps Services. En Azure DevOps Server local se debe reemplazar por `PublishBuildArtifacts@1`.

## Compilar y descargar el APK

1. Abre el pipeline `FashionStore Android APK` y pulsa **Run pipeline**.
2. El agente valida Node 20.19.x, Java 17 y Android SDK.
3. El script consulta `GET <EXPO_PUBLIC_API_URL>/health`, espera reintentos para permitir el arranque en frío y exige `estado: "ok"` y el servicio NestJS.
4. Instala dependencias con `npm ci` usando `mobile-app/package-lock.json`.
5. Ejecuta `tsc --noEmit`.
6. Asigna un `versionCode` de CI superior al valor base sin modificar el archivo versionado en Git.
7. Ejecuta `expo prebuild --platform android --clean --no-install`, con `EAS_BUILD_PROFILE=azure` para desactivar el permiso de tráfico HTTP plano.
8. Genera una clave temporal de pruebas en el agente y asigna esa firma al build type `release`.
9. Gradle ejecuta `:app:assembleRelease`.
10. El script comprueba la firma con `apksigner`, alineación con `zipalign`, paquete/versión con `aapt`, integridad ZIP y existencia de `assets/index.android.bundle`. También verifica que el bundle contenga la URL pública de API configurada.
11. En el resumen de la ejecución, abre **Published → FashionStore-APK** y descarga el artefacto. Dentro estará `FashionStore-<version>-<BuildId>.apk`.

## Firma y actualizaciones

Por defecto, el agente crea una clave temporal para que el APK se pueda instalar en un dispositivo de prueba sin configurar una cuenta de tienda. El agente Microsoft-hosted es efímero; por tanto, la clave puede cambiar entre ejecuciones y Android puede rechazar una actualización sobre la instalación anterior. En ese caso desinstala el APK anterior antes de instalar el nuevo.

Para actualizar la misma instalación sin desinstalar, configurar una clave de firma persistente como **Secure File** de Azure DevOps y adaptar el bloque de firma del script para utilizar ese keystore. Nunca subas el keystore ni sus contraseñas a GitHub ni los incluyas en el ZIP.

Este APK RELEASE firmado con clave interna de pruebas no debe subirse a Google Play. Para Google Play se requiere una upload key privada estable y configurar la firma de release correspondiente.

## Costos y límites

- Azure Pipelines usa un agente hospedado temporal; la disponibilidad/minutos paralelos depende de la organización y su plan.
- No se crea una VM ni Container App permanente para compilar.
- Se necesita conectividad a npm, Google Android SDK y Gradle para descargar dependencias.
- El job tiene un timeout de 60 minutos y limita los workers de Gradle para ajustarse al agente hospedado.
- La URL `EXPO_PUBLIC_API_URL` queda dentro del bundle Android y no es un secreto. No coloques `DATABASE_URL`, `JWT_SECRET`, `IA_INTERNAL_KEY`, Groq/Gemini ni credenciales privadas en variables `EXPO_PUBLIC_*`.

## Limitaciones de verificación

El pipeline verifica la compilación nativa, la firma, la alineación, el `applicationId`, el `versionCode`, el bundle JS y la URL de API. No inicia un emulador Android en el agente Linux hospedado. La prueba final de instalación/ejecución se debe realizar en un teléfono Android real; Azure Pipelines no debe marcarse como prueba funcional en dispositivo si no se ejecuta ese paso aparte.
