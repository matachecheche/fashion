#!/usr/bin/env bash
# Build standalone FashionStore APK on an Azure Pipelines Microsoft-hosted agent.
# Uses the RELEASE variant so Metro/Metro Dev Server is not required on the phone.
set -Eeuo pipefail

log() { printf '\n[%s] %s\n' "$(date -u +'%H:%M:%S UTC')" "$*"; }
fail() {
  printf '##vso[task.logissue type=error]%s\n' "$*"
  echo "[ERROR] $*" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$MOBILE_DIR/.." && pwd)"
ARTIFACT_DIR="${BUILD_ARTIFACTSTAGINGDIRECTORY:-$REPO_ROOT/artifacts/FashionStore-APK}"
API_BASE_URL="${EXPO_PUBLIC_API_URL:-}"
API_BASE_URL="${API_BASE_URL%/}"

[[ -n "$API_BASE_URL" ]] || fail "Falta EXPO_PUBLIC_API_URL. Crea la variable en el grupo Azure DevOps 'fashionstore-mobile'."
[[ "$API_BASE_URL" == https://* ]] || fail "EXPO_PUBLIC_API_URL debe utilizar HTTPS. Valor recibido: $API_BASE_URL"
[[ "$API_BASE_URL" == */api ]] || fail "EXPO_PUBLIC_API_URL debe terminar en /api. Ejemplo: https://fashionstore-api.example.azurecontainerapps.io/api"

command -v node >/dev/null 2>&1 || fail "Node.js no está disponible en el agente Azure."
command -v npm >/dev/null 2>&1 || fail "npm no está disponible en el agente Azure."
command -v java >/dev/null 2>&1 || fail "Java no está disponible en el agente Azure."
command -v keytool >/dev/null 2>&1 || fail "keytool no está disponible; revisa la instalación de JDK 17."
command -v curl >/dev/null 2>&1 || fail "curl no está disponible en el agente Azure."
command -v unzip >/dev/null 2>&1 || fail "unzip no está disponible en el agente Azure."

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
JAVA_MAJOR="$(java -version 2>&1 | awk -F '[".]' '/version/ {print $2; exit}')"
[[ "$NODE_MAJOR" == "20" ]] || fail "Se requiere Node.js 20.x para esta compilación Expo SDK 54; se encontró $(node --version)."
[[ "$JAVA_MAJOR" == "17" ]] || fail "Se requiere Java 17 para Expo SDK 54/Gradle; se encontró Java $JAVA_MAJOR."

log "Validando API de producción antes de compilar: $API_BASE_URL/health"
HEALTH_JSON="${AGENT_TEMPDIRECTORY:-/tmp}/fashionstore-api-health.json"
HEALTH_OK=0
for attempt in $(seq 1 18); do
  HTTP_CODE="$(curl --silent --show-error --location --connect-timeout 10 --max-time 20 \
    --output "$HEALTH_JSON" --write-out '%{http_code}' "$API_BASE_URL/health" 2>/dev/null || true)"
  if [[ "$HTTP_CODE" == "200" ]]; then
    if node - "$HEALTH_JSON" <<'NODE'
const fs = require('node:fs');
try {
  const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  if (body.estado !== 'ok') process.exit(1);
  if (body.servicio && !String(body.servicio).includes('fashionstore-backend-nest')) process.exit(1);
} catch { process.exit(1); }
NODE
    then
      HEALTH_OK=1
      break
    fi
  fi
  log "API aún no está lista (intento $attempt/18, HTTP ${HTTP_CODE:-sin respuesta}); se reintentará en 10 s."
  sleep 10
done
[[ "$HEALTH_OK" == "1" ]] || {
  [[ -f "$HEALTH_JSON" ]] && cat "$HEALTH_JSON" || true
  fail "La API no confirmó estado=ok en $API_BASE_URL/health. Se detuvo antes de consumir tiempo de compilación."
}
log "API saludable y responde el endpoint NestJS esperado."

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_HOME ANDROID_SDK_ROOT
mkdir -p "$ANDROID_HOME"
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"

# Azure's ubuntu-24.04 agent normally provides cmdline-tools. If it does not,
# install a pinned Google command-line-tools package instead of failing silently.
if [[ ! -x "$SDKMANAGER" ]]; then
  EXISTING_SDKMANAGER="$(find "$ANDROID_HOME/cmdline-tools" -type f -name sdkmanager -print -quit 2>/dev/null || true)"
  if [[ -n "$EXISTING_SDKMANAGER" ]]; then
    SDKMANAGER="$EXISTING_SDKMANAGER"
  else
    log "Android SDK command-line tools no están presentes; instalando la versión fijada de Google."
    TOOLS_ZIP="${AGENT_TEMPDIRECTORY:-/tmp}/commandlinetools-linux-11076708_latest.zip"
    curl --fail --show-error --location --retry 5 --retry-all-errors \
      "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" \
      --output "$TOOLS_ZIP"
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    unzip -q "$TOOLS_ZIP" -d "$ANDROID_HOME/cmdline-tools"
    mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
    SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  fi
fi
[[ -x "$SDKMANAGER" ]] || fail "No se pudo localizar o instalar sdkmanager en $ANDROID_HOME."

log "Aceptando licencias e instalando componentes exactos para Expo SDK 54 (Android 36, NDK 27.1)."
set +o pipefail
yes | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 || true
set -o pipefail
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" --install \
  "platform-tools" \
  "platforms;android-36" \
  "build-tools;36.0.0" \
  "ndk;27.1.12297006" \
  "cmake;3.22.1"

BUILD_TOOLS="$ANDROID_HOME/build-tools/36.0.0"
APKSIGNER="$BUILD_TOOLS/apksigner"
ZIPALIGN="$BUILD_TOOLS/zipalign"
AAPT="$BUILD_TOOLS/aapt"
for tool in "$APKSIGNER" "$ZIPALIGN" "$AAPT"; do
  [[ -x "$tool" ]] || fail "Falta herramienta Android requerida: $tool"
done

log "Instalando las dependencias móviles usando package-lock.json."
cd "$MOBILE_DIR"
export npm_config_fetch_retries=5
export npm_config_fetch_retry_mintimeout=20000
export npm_config_fetch_retry_maxtimeout=120000
export npm_config_audit=false
export npm_config_fund=false
NPM_CACHE="${NPM_CONFIG_CACHE:-${PIPELINE_WORKSPACE:-$REPO_ROOT}/.npm}"
mkdir -p "$NPM_CACHE"
npm ci --legacy-peer-deps --cache "$NPM_CACHE" --prefer-offline --no-audit --no-fund

log "Validando TypeScript."
npx --no-install tsc --noEmit

# Assign a monotonically increasing versionCode to this CI artifact without
# changing the checked-out source file in the developer's working copy.
BUILD_ID="${BUILD_BUILDID:-1}"
node - "$MOBILE_DIR/app.json" "$BUILD_ID" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const buildId = Number.parseInt(process.argv[3], 10);
if (!Number.isSafeInteger(buildId) || buildId < 1) throw new Error('BUILD_BUILDID inválido');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
config.expo.android.versionCode = Math.min(2100000000, 1000000 + buildId);
fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
NODE

APP_VERSION="$(node -e "const a=require('./app.json').expo; console.log(a.version)")"
APP_VERSION_CODE="$(node -e "const a=require('./app.json').expo; console.log(a.android.versionCode)")"
EXPECTED_PACKAGE="$(node -e "const a=require('./app.json').expo; console.log(a.android.package)")"

log "Generando proyecto Android con Expo Prebuild (perfil azure; HTTP plano desactivado)."
export CI=1
export EAS_BUILD_PROFILE=azure
export EXPO_PUBLIC_API_URL="$API_BASE_URL"
export EXPO_PUBLIC_DEFAULT_TENANT_SLUG="${EXPO_PUBLIC_DEFAULT_TENANT_SLUG:-legacy}"
npx --no-install expo prebuild --platform android --clean --no-install

GRADLEW="$MOBILE_DIR/android/gradlew"
APP_GRADLE="$MOBILE_DIR/android/app/build.gradle"
[[ -x "$GRADLEW" || -f "$GRADLEW" ]] || fail "Expo Prebuild no generó android/gradlew."
[[ -f "$APP_GRADLE" ]] || fail "Expo Prebuild no generó android/app/build.gradle."
chmod +x "$GRADLEW"

# React Native requires the release JS bundle task to run; configure-on-demand can
# skip it in some Gradle setups, so remove that incompatible opt-in if present.
GRADLE_PROPERTIES="$MOBILE_DIR/android/gradle.properties"
if [[ -f "$GRADLE_PROPERTIES" ]] && grep -Eiq '^[[:space:]]*org\.gradle\.configureondemand[[:space:]]*=[[:space:]]*true' "$GRADLE_PROPERTIES"; then
  sed -i -E '/^[[:space:]]*org\.gradle\.configureondemand[[:space:]]*=[[:space:]]*true[[:space:]]*$/Id' "$GRADLE_PROPERTIES"
  log "Se desactivó org.gradle.configureondemand para garantizar el bundle JavaScript release."
fi

# Create a temporary CI-only key and explicitly sign the RELEASE variant with it.
# This gives an installable standalone APK with its JS bundle (no Metro server).
# For stable upgrades between builds, replace this key with an Azure Secure File.
# Prefer a stable Azure secret keystore so each APK can update the installed app.
# For a first smoke-test build only, fall back to a temporary signing key.
normalize_azure_macro() {
  local value="${1:-}"
  if [[ "$value" =~ ^\$\([A-Za-z0-9_]+\)$ ]]; then value=""; fi
  printf '%s' "$value"
}
ANDROID_KEYSTORE_BASE64="$(normalize_azure_macro "${ANDROID_KEYSTORE_BASE64:-}")"
ANDROID_KEYSTORE_PASSWORD="$(normalize_azure_macro "${ANDROID_KEYSTORE_PASSWORD:-}")"
ANDROID_KEY_ALIAS="$(normalize_azure_macro "${ANDROID_KEY_ALIAS:-}")"
ANDROID_KEY_PASSWORD="$(normalize_azure_macro "${ANDROID_KEY_PASSWORD:-}")"

if [[ -n "$ANDROID_KEYSTORE_BASE64" ]]; then
  [[ -n "$ANDROID_KEYSTORE_PASSWORD" && -n "$ANDROID_KEY_ALIAS" && -n "$ANDROID_KEY_PASSWORD" ]] || \
    fail "Para firma estable define ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS y ANDROID_KEY_PASSWORD junto con ANDROID_KEYSTORE_BASE64."
  SIGNING_KEYSTORE="${AGENT_TEMPDIRECTORY:-/tmp}/fashionstore-release.keystore"
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$SIGNING_KEYSTORE" || fail "ANDROID_KEYSTORE_BASE64 no es Base64 válido."
  [[ -s "$SIGNING_KEYSTORE" ]] || fail "El keystore de Azure está vacío."
  SIGNING_MODE="keystore persistente de Azure"
else
  DEBUG_KEYSTORE="$HOME/.android/debug.keystore"
  mkdir -p "$(dirname "$DEBUG_KEYSTORE")"
  if [[ ! -s "$DEBUG_KEYSTORE" ]]; then
    keytool -genkeypair -v \
      -keystore "$DEBUG_KEYSTORE" \
      -storepass android \
      -alias androiddebugkey \
      -keypass android \
      -keyalg RSA -keysize 2048 -validity 10000 \
      -dname "CN=FashionStore CI Debug,O=FashionStore,C=BO" \
      >/dev/null 2>&1
  fi
  SIGNING_KEYSTORE="$DEBUG_KEYSTORE"
  ANDROID_KEYSTORE_PASSWORD="android"
  ANDROID_KEY_ALIAS="androiddebugkey"
  ANDROID_KEY_PASSWORD="android"
  SIGNING_MODE="clave temporal de CI (no permite actualización sobre otra firma)"
  log "AVISO: no se configuró keystore persistente. Este APK es instalable, pero puede requerir desinstalar la versión previa para actualizar."
fi

export ANDROID_KEYSTORE_FILE="$SIGNING_KEYSTORE"
export ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD
cat > "$MOBILE_DIR/android/app/fashionstore-ci-signing.gradle" <<'GRADLE'
def fsKeystore = System.getenv('ANDROID_KEYSTORE_FILE')
def fsStorePassword = System.getenv('ANDROID_KEYSTORE_PASSWORD')
def fsKeyAlias = System.getenv('ANDROID_KEY_ALIAS')
def fsKeyPassword = System.getenv('ANDROID_KEY_PASSWORD')
if (![fsKeystore, fsStorePassword, fsKeyAlias, fsKeyPassword].every { it }) {
    throw new GradleException('Faltan variables de firma Android para FashionStore.')
}
if (!new File(fsKeystore).isFile()) {
    throw new GradleException('No existe el keystore Android configurado: ' + fsKeystore)
}
android {
    signingConfigs {
        release {
            storeFile file(fsKeystore)
            storePassword fsStorePassword
            keyAlias fsKeyAlias
            keyPassword fsKeyPassword
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
GRADLE

# Expo Prebuild recreates android/ on every run. Attach our release signing
# configuration after the Android application plugin has declared its DSL.
if ! grep -Fq "fashionstore-ci-signing.gradle" "$APP_GRADLE"; then
  printf "\n// Firma release de FashionStore (inyectada por CI).\napply from: file(\"\$projectDir/fashionstore-ci-signing.gradle\")\n" >> "$APP_GRADLE"
fi

log "Compilando variante RELEASE autocontenida mediante Gradle."
cd "$MOBILE_DIR/android"
export GRADLE_OPTS="${GRADLE_OPTS:--Xmx4g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8}"
./gradlew --no-daemon --no-parallel --max-workers=2 --stacktrace :app:assembleRelease

APK_SOURCE="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
[[ -s "$APK_SOURCE" ]] || fail "Gradle terminó sin producir app/build/outputs/apk/release/app-release.apk."

log "Verificando firma, alineación, paquete y bundle JavaScript incluido."
"$APKSIGNER" verify --verbose --print-certs "$APK_SOURCE"
"$ZIPALIGN" -c -v 4 "$APK_SOURCE"
BADGING="$("$AAPT" dump badging "$APK_SOURCE")"
grep -Fq "package: name='$EXPECTED_PACKAGE'" <<<"$BADGING" || fail "El APK no contiene el applicationId esperado ($EXPECTED_PACKAGE)."
grep -Fq "versionName='$APP_VERSION'" <<<"$BADGING" || fail "El APK no contiene versionName=$APP_VERSION."
grep -Fq "versionCode='$APP_VERSION_CODE'" <<<"$BADGING" || fail "El APK no contiene versionCode=$APP_VERSION_CODE."

if ! unzip -Z1 "$APK_SOURCE" | grep -Fxq 'assets/index.android.bundle'; then
  fail "El APK no contiene assets/index.android.bundle; no sería autónomo y dependería de Metro."
fi
if ! unzip -p "$APK_SOURCE" assets/index.android.bundle | grep -aFq "$API_BASE_URL"; then
  fail "La URL de API de producción no quedó incrustada en el bundle JavaScript del APK."
fi
unzip -t "$APK_SOURCE" >/dev/null
APK_BYTES="$(stat -c '%s' "$APK_SOURCE")"
(( APK_BYTES > 1000000 )) || fail "El APK parece incompleto: solo $APK_BYTES bytes."

mkdir -p "$ARTIFACT_DIR"
APK_NAME="FashionStore-${APP_VERSION}-${BUILD_ID}.apk"
cp "$APK_SOURCE" "$ARTIFACT_DIR/$APK_NAME"
APK_SHA256="$(sha256sum "$ARTIFACT_DIR/$APK_NAME" | awk '{print $1}')"

cat > "$ARTIFACT_DIR/INFORMACION-BUILD.txt" <<EOF
Aplicación: FashionStore
Versión: $APP_VERSION
VersionCode CI: $APP_VERSION_CODE
Build Azure Pipelines: ${BUILD_BUILDID:-local}
Commit: ${BUILD_SOURCEVERSION:-local}
API incorporada: $API_BASE_URL
Variante: release APK autónomo (incluye assets/index.android.bundle)
Firma: $SIGNING_MODE. Para actualizaciones consecutivas se recomienda keystore persistente; Google Play requiere configurar una clave de producción protegida.
Tamaño: $APK_BYTES bytes
SHA-256: $APK_SHA256
EOF

log "APK RELEASE autónomo generado y verificado: $ARTIFACT_DIR/$APK_NAME"
echo "APK_SHA256=$APK_SHA256"
echo "APK_SIZE_BYTES=$APK_BYTES"
