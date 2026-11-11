@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem ============================================================================
rem  build-apk.bat - Compila un APK Android con Expo Application Services (EAS)
rem  Uso: build-apk.bat [development|preview|azure]   (por defecto: development)
rem  Requisitos: Node.js 18+, cuenta Expo/EAS (eas login), sin secretos en Git.
rem  El APK NO se fabrica sin acceso real a EAS. Si el servicio no esta disponible,
rem  este script falla con un mensaje claro y codigo de salida distinto de cero.
rem ============================================================================

set PROFILE=%~1
if "%PROFILE%"=="" set PROFILE=development
if /I not "%PROFILE%"=="development" if /I not "%PROFILE%"=="preview" if /I not "%PROFILE%"=="azure" (
  echo [ERROR] Perfil invalido "%PROFILE%". Usa development, preview o azure.
  exit /b 2
)

where node >nul 2>&1 || (echo [ERROR] Node.js no esta instalado o no esta en PATH. && exit /b 3)
where npx >nul 2>&1 || (echo [ERROR] npx no disponible. Reinstala Node.js LTS. && exit /b 3)

cd /d "%~dp0" || exit /b 4
if not exist builds mkdir builds

echo ==^> Perfil EAS seleccionado: %PROFILE%
echo ==^> Verificando eas-cli...
where eas >nul 2>&1
if %ERRORLEVEL%==0 (
  set EAS_CMD=eas
) else (
  echo ==^> eas-cli no esta instalado globalmente; se instalara eas-cli localmente en este proyecto.
  call npm install --no-save eas-cli@latest
  if errorlevel 1 (
    echo [ERROR] No se pudo instalar eas-cli. Instalacion manual: npm install -g eas-cli
    exit /b 5
  )
  set EAS_CMD=npx --yes eas-cli
)

echo ==^> Verificando sesion EAS...
call %EAS_CMD% whoami >nul 2>&1
if errorlevel 1 (
  echo [ACCION REQUERIDA] No hay sesion EAS activa.
  echo Ejecuta: %EAS_CMD% login
  echo Iniciara sesion en el navegador; no pegues contrasenas aqui ni en archivos.
  exit /b 6
)

echo ==^> Verificando proyecto EAS enlazado (projectId en app.json extra.eas)...
call %EAS_CMD% init --non-interactive >nul 2>&1
rem Si ya existia un projectId, init lo respeta; si falta, lo crea o reporta el error real.
if errorlevel 1 (
  echo [AVISO] eas project:info fallo o el proyecto no esta enlazado aun. Continuando; el build reportara el estado real.
)

echo ==^> Instalando dependencias desde lockfile (npm ci)...
call npm ci --legacy-peer-deps
if errorlevel 1 (
  echo [ERROR] npm ci fallo. Verifica tu conexion y el lockfile.
  exit /b 7
)

echo ==^> TypeScript...
call npx tsc --noEmit
if errorlevel 1 (
  echo [ERROR] Errores de TypeScript. Corrijalos antes de compilar el APK.
  exit /b 8
)

echo ==^> Iniciando build Android perfil "%PROFILE%" (esto puede tardar varios minutos)...
call %EAS_CMD% build --platform android --profile %PROFILE% --non-interactive --json > builds\ultima-build.json 2> builds\ultima-build.log
if errorlevel 1 (
  echo [ERROR] El build EAS finalizo con error o fue cancelado. Revisa builds\ultima-build.log
  exit /b 9
)

echo ==^> Build finalizado. Extrayendo URL del artefacto...
for /f "usebackq delims=" %%U in (`node -e "try{const d=JSON.parse(require('fs').readFileSync('builds/ultima-build.json','utf8'));const b=Array.isArray(d)?d[0]:d;process.stdout.write(b.artifacts&&b.artifacts.buildUrl?b.artifacts.buildUrl:'')}catch(e){process.stdout.write('')}"`) do set BUILD_URL=%%U

if "%BUILD_URL%"=="" (
  echo [AVISO] No se pudo extraer la URL del artefacto. Revisa builds\ultima-build.json
  exit /b 10
)

echo ==^> Descargando APK desde %BUILD_URL% ...
set APK_DEST=builds\FashionStore-%PROFILE%-%RANDOM%.apk

call npx --yes @expo/eas-cli download --url "%BUILD_URL%" --output "%APK_DEST%" >nul 2>&1
if not exist "%APK_DEST%" (
  echo ==^> eas download no disponible; intentando descarga directa con PowerShell...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri '%BUILD_URL%' -OutFile '%APK_DEST%' -UseBasicParsing" || (
    echo [ERROR] No se pudo descargar el APK. Abrir manualmente: %BUILD_URL%
    exit /b 11
  )
)

for %%A in ("%APK_DEST%") do set APK_SIZE=%%~zA
if "%APK_SIZE%"=="0" (
  echo [ERROR] El APK descargado esta vacio, 0 bytes. Eliminando...
  del /f /q "%APK_DEST%"
  exit /b 12
)

echo ==^> Calculando SHA-256...
for /f "skip=1 tokens=* delims=" %%H in ('powershell -NoProfile -Command "Get-FileHash -Algorithm SHA256 '%APK_DEST%' | ForEach-Object { $_.Hash }"') do set APK_SHA256=%%H

echo.
echo =================================================================
echo  APK generado (prueba en Android real antes de distribuir)
echo  Ruta:    %~dp0%APK_DEST%
echo  Tamano:  %APK_SIZE% bytes
echo  SHA-256: %APK_SHA256%
echo =================================================================
exit /b 0
