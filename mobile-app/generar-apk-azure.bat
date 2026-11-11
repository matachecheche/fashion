@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem ============================================================================
rem  generar-apk-azure.bat — APK conectado a la API publicada en Azure.
rem  1) Pide la URL HTTPS de NestJS en Azure
rem  2) Comprueba que /api/health responda
rem  3) Guarda EXPO_PUBLIC_API_URL en el entorno EAS "production"
rem  4) Ejecuta build-apk.bat azure y descarga/valida el APK
rem  Sin API desplegada y saludable NO hay APK honesto: este script se detiene.
rem ============================================================================

cd /d "%~dp0" || exit /b 1

set "API_URL=%~1"
if "%API_URL%"=="" (
  set /p "API_URL=URL publica HTTPS de NestJS en Azure (ej: https://fashionstore-api-xxxx.azurecontainerapps.io): "
)

rem Limpieza: quitar slashes finales y sufijo /api duplicado
:limpiar
set "_LAST=!API_URL:~-1!"
if "!_LAST!"=="/" (
  set "API_URL=!API_URL:~0,-1!"
  goto limpiar
)
set "API_URL=%API_URL%"

echo %API_URL% | findstr /I /R "^https://" >nul
if errorlevel 1 (
  echo [ERROR] La URL debe ser HTTPS (ej: https://...azurecontainerapps.io). No uses http ni IP.
  exit /b 2
)

set "API_ROOT=%API_URL%"
if /I "!API_URL:~-4!"=="/api" (
  set "HEALTH_URL=!API_URL!/health"
) else (
  set "HEALTH_URL=!API_URL!/api/health"
  set "API_ROOT=!API_URL!/api"
)
echo ==^> Comprobando salud de la API: %HEALTH_URL%
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%HEALTH_URL%' -UseBasicParsing -TimeoutSec 20; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { Write-Host 'API SALUDABLE (HTTP ' $r.StatusCode ')'; exit 0 } else { Write-Host 'API respondio HTTP ' $r.StatusCode; exit 1 } } catch { Write-Host ('API NO SALUDABLE: ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 (
  echo [ERROR] La API no responde correctamente en Azure. Despliega primero (desplegar-azure.bat) y vuelve a intentar.
  exit /b 3
)

echo ==^> Guardando EXPO_PUBLIC_API_URL=%API_ROOT% en el entorno EAS production...
where eas >nul 2>&1 && set EAS_CMD=eas || set EAS_CMD=npx --yes eas-cli
call %EAS_CMD% whoami >nul 2>&1 || (
  echo [ACCION REQUERIDA] Inicia sesion EAS primero: %EAS_CMD% login
  exit /b 6
)
rem Variable PUBLICA (no es secreto): la URL de la API. Si ya existe, actualizar.
call %EAS_CMD% env:create --environment production --name EXPO_PUBLIC_API_URL --value "%API_ROOT%" --visibility plaintext --non-interactive >nul 2>&1
if errorlevel 1 (
  echo ==^> La variable ya existe o no se pudo crear; actualizando...
  call %EAS_CMD% env:update --environment production --name EXPO_PUBLIC_API_URL --value "%API_ROOT%" --visibility plaintext --non-interactive >nul 2>&1
)
if errorlevel 1 (
  echo [AVISO] No se pudo fijar la variable en EAS automaticamente.
  echo Fija manualmente: %EAS_CMD% env:create --environment production --name EXPO_PUBLIC_API_URL --value "%API_ROOT%" --visibility plaintext
)

echo ==^> Ejecutando build del APK perfil azure...
call "%~dp0build-apk.bat" azure
exit /b %ERRORLEVEL%
