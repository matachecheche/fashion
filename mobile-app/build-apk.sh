#!/usr/bin/env bash
# Compila un APK Android con EAS. Uso: ./build-apk.sh [development|preview|azure]
set -euo pipefail
PROFILE="${1:-development}"
case "$PROFILE" in development|preview|azure) ;; *) echo "Perfil invalido '$PROFILE'" >&2; exit 2;; esac
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js no instalado" >&2; exit 3; }
EAS="eas"; command -v eas >/dev/null || EAS="npx --yes eas-cli"
mkdir -p builds
npx tsc --noEmit
$EAS build --platform android --profile "$PROFILE" --non-interactive --json > builds/ultima-build.json
URL=$(node -e "const d=JSON.parse(require('fs').readFileSync('builds/ultima-build.json','utf8'));const b=Array.isArray(d)?d[0]:d;process.stdout.write((b.artifacts&&b.artifacts.buildUrl)||'')")
[ -n "$URL" ] || { echo "Sin URL de APK en el JSON de EAS" >&2; exit 10; }
DEST="builds/FashionStore-${PROFILE}-$RANDOM.apk"
curl -fSL --retry 3 -o "$DEST" "$URL"
SIZE=$(stat -c%s "$DEST")
[ "$SIZE" -gt 0 ] || { echo "APK vacio" >&2; rm -f "$DEST"; exit 12; }
sha256sum "$DEST"
echo "APK: $DEST ($SIZE bytes)"
