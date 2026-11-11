# APK Android autónomo de FashionStore en Azure Pipelines

El pipeline de este repositorio genera un **APK de la variante RELEASE** en un agente Microsoft-hosted `ubuntu-24.04`. No genera un development client ni un `assembleDebug` que dependa de Metro. Expo realiza el prebuild y Gradle incorpora el bundle JavaScript al APK mediante `:app:assembleRelease`.

## Qué genera

- Archivo `.apk` instalable directamente en un teléfono Android.
- Variante Android `release`, con `assets/index.android.bundle` incluido; no necesita Metro ni una PC para servir JavaScript.
- `applicationId` esperado: `bo.fashionstore.app`.
- URL de NestJS Azure incorporada en el bundle desde `EXPO_PUBLIC_API_URL`.
- APK firmado con el mismo keystore privado en Azure cuando se configuran los cuatro secretos de firma. La clave temporal queda solo como fallback de prueba y no conserva la identidad entre agentes hospedados.
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
8. Aplica la configuración de firma al build type `release`: reutiliza el keystore persistente configurado en el grupo de variables o, solo para pruebas, genera una clave temporal.
9. Gradle ejecuta `:app:assembleRelease`.
10. El script comprueba la firma con `apksigner`, alineación con `zipalign`, paquete/versión con `aapt`, integridad ZIP y existencia de `assets/index.android.bundle`. También verifica que el bundle contenga la URL pública de API configurada.
11. En el resumen de la ejecución, abre **Published → FashionStore-APK** y descarga el artefacto. Dentro estará `FashionStore-<version>-<BuildId>.apk`.

## Firma y actualizaciones

Para que las nuevas versiones se instalen **encima de la versión anterior sin desinstalarla**, debes conservar la misma clave privada de firma. El pipeline admite esa identidad estable mediante estas variables del grupo `fashionstore-mobile` (las cuatro contraseñas/valores deben ser secretos donde corresponda):

- `ANDROID_KEYSTORE_BASE64`: contenido Base64 del keystore privado (`.jks` o `.keystore`), almacenado como variable secreta.
- `ANDROID_KEYSTORE_PASSWORD`: contraseña del keystore (secreta).
- `ANDROID_KEY_ALIAS`: alias de la clave.
- `ANDROID_KEY_PASSWORD`: contraseña de la clave (secreta).

Genera el keystore **una sola vez** en una máquina protegida y guarda una copia de respaldo cifrada. Ejemplo (personaliza el alias y resguarda las contraseñas):

```bash
keytool -genkeypair -v -keystore fashionstore-release.keystore -alias fashionstore -keyalg RSA -keysize 2048 -validity 10000
base64 -w 0 fashionstore-release.keystore
```

Copia el resultado Base64 al secreto `ANDROID_KEYSTORE_BASE64` y completa las otras tres variables. No regeneres el keystore entre versiones, no lo guardes en el repositorio, ni lo incluyas en el APK. El script detecta esas variables y firma con la clave persistente. El pipeline no imprime su contenido ni sus contraseñas.

Si no configuras las variables, el pipeline usa una clave de CI temporal para permitir una compilación de prueba. Ese APK se puede instalar, pero su firma puede cambiar entre ejecuciones y Android puede exigir desinstalar la versión anterior antes de instalarlo. El archivo `INFORMACION-BUILD.txt` identifica el tipo de firma utilizado.

La clave de pruebas no debe utilizarse para Google Play. Para Play configura una upload key estable, con custodia y política de respaldo propia.

## Costos y límites

- Azure Pipelines usa un agente hospedado temporal; la disponibilidad/minutos paralelos depende de la organización y su plan.
- No se crea una VM ni Container App permanente para compilar.
- Se necesita conectividad a npm, Google Android SDK y Gradle para descargar dependencias.
- El job tiene un timeout de 60 minutos y limita los workers de Gradle para ajustarse al agente hospedado.
- La URL `EXPO_PUBLIC_API_URL` queda dentro del bundle Android y no es un secreto. No coloques `DATABASE_URL`, `JWT_SECRET`, `IA_INTERNAL_KEY`, Groq/Gemini ni credenciales privadas en variables `EXPO_PUBLIC_*`.

## Limitaciones de verificación

El pipeline verifica la compilación nativa, la firma, la alineación, el `applicationId`, el `versionCode`, el bundle JS y la URL de API. No inicia un emulador Android en el agente Linux hospedado. La prueba final de instalación/ejecución se debe realizar en un teléfono Android real; Azure Pipelines no debe marcarse como prueba funcional en dispositivo si no se ejecuta ese paso aparte.

### Ejecutar las pruebas en Windows sin WSL

El script `mobile-app/ci/build-azure-apk.sh` se ejecuta en el agente Linux `ubuntu-24.04` de Azure Pipelines. En Windows, la prueba local busca GNU Bash real (incluido Git Bash). Si solo encuentra el lanzador `bash.exe` de WSL y no hay una distribución Linux instalada, la prueba de sintaxis Bash se marca como **omitida**, no como fallida. Esto no omite la comprobación en Azure: el agente Ubuntu ejecuta el script y el pipeline falla si la sintaxis es incorrecta. Para ejecutar esa comprobación también localmente, instala Git for Windows con Git Bash o una distribución WSL.

## Alternativa sin Azure DevOps: compilar el APK en GitHub Actions

El workflow `.github/workflows/build-apk.yml` ejecuta el mismo script `mobile-app/ci/build-azure-apk.sh` en GitHub Actions.

1. Despliega primero la API en Azure (`desplegar-azure.bat`) y copia su URL pública HTTPS terminada en `/api`.
2. En GitHub: **Actions → Build APK Android (release autónomo) → Run workflow** y pega esa URL (o guárdala una vez como variable de repositorio `EXPO_PUBLIC_API_URL`).
3. Al terminar, descarga el artefacto **FashionStore-APK** desde el resumen de la ejecución.
