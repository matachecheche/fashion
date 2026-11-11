# Compila un APK Android con EAS. Uso: ./build-apk.ps1 [development|preview|azure]
$ErrorActionPreference = 'Stop'
$Profile = if ($args[0]) { $args[0] } else { 'development' }
if ($Profile -notin @('development', 'preview', 'azure')) {
  Write-Error "Perfil invalido '$Profile'. Usa development, preview o azure."
  exit 2
}
Set-Location -Path $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'Node.js no instalado.'; exit 3 }
$EAS = if (Get-Command eas -ErrorAction SilentlyContinue) { 'eas' } else { 'npx --yes eas-cli' }
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Write-Error 'TypeScript con errores.'; exit 8 }
New-Item -ItemType Directory -Force -Path builds | Out-Null
& cmd /c "%EAS%" build --platform android --profile $Profile --non-interactive --json > builds/ultima-build.json
if ($LASTEXITCODE -ne 0) { Write-Error "Build EAS fallo (o fue cancelado). Revisa builds/ultima-build.json y builds/ultima-build.log"; exit 9 }
$info = Get-Content builds/ultima-build.json -Raw | ConvertFrom-Json
if ($info -is [array]) { $info = $info[0] }
$url = $info.artifacts.buildUrl
if (-not $url) { Write-Error 'No se pudo extraer la URL del APK del JSON de EAS.'; exit 10 }
$dest = Join-Path builds ("FashionStore-$Profile-$(Get-Random).apk")
Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
$size = (Get-Item $dest).Length
if ($size -eq 0) { Remove-Item $dest -Force; Write-Error 'APK vacio; eliminado.'; exit 12 }
$hash = (Get-FileHash -Algorithm SHA256 $dest).Hash
Write-Host "APK: $dest"
Write-Host "Tamano: $size bytes"
Write-Host "SHA-256: $hash"
exit 0
