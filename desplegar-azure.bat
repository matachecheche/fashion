@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo FashionStore - despliegue asistido Azure Container Apps + Neon
echo =============================================================
echo AVISO: no se crea ACR; Container Apps/egress pueden generar cargos fuera de cuotas.
echo El script pedira confirmacion antes de modificar Neon o crear recursos.
echo La guia completa esta en docs\DESPLIEGUE-AZURE.md
echo.

where az >nul 2>&1
if errorlevel 1 goto NO_AZURE

rem Azure CLI is usually az.cmd on Windows; CALL is required to resume this BAT.
call az account show --only-show-errors --output none >nul 2>&1
if errorlevel 1 (
  echo No hay una sesion Azure CLI activa. Se abrira el inicio de sesion de Microsoft.
  call az login
  if errorlevel 1 goto LOGIN_ERROR
) else (
  echo [OK] Se reutilizara la sesion Azure CLI activa.
)

echo.
echo Suscripcion activa en Azure CLI:
call az account show --query "{name:name,id:id,tenantId:tenantId}" --output table
if errorlevel 1 goto LOGIN_ERROR

echo.
where psql >nul 2>&1
if not errorlevel 1 (
  echo [OK] psql encontrado. Solo se necesita el cliente, no un servidor local.
  goto HAVE_SQL_CLIENT
)
where node >nul 2>&1
if errorlevel 1 goto NO_SQL_CLIENT
echo [OK] psql no esta instalado; se probara el ayudante Node.js con el paquete pg de backend-nest.

:HAVE_SQL_CLIENT
where py >nul 2>&1
if not errorlevel 1 (
  set "PYTHON=py -3"
  goto HAVE_PYTHON
)
where python >nul 2>&1
if errorlevel 1 goto NO_PYTHON
set "PYTHON=python"

:HAVE_PYTHON
%PYTHON% --version
if errorlevel 1 goto NO_PYTHON
%PYTHON% -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)"
if errorlevel 1 goto PYTHON_TOO_OLD

echo Version de Azure CLI instalada:
call az version --output json
echo.
where az | findstr /I /C:"Program Files (x86)" >nul
if errorlevel 1 goto CLI_64
echo [AVISO] Tienes Azure CLI de 32 bits, carpeta Program Files x86. Sus extensiones pueden fallar
echo al instalarse con el error maturin o pip. Si ocurre, instala la version de 64 bits:
echo https://aka.ms/installazurecliwindowsx64
echo.
:CLI_64
call az extension show --name containerapp --only-show-errors --output none >nul 2>&1
if not errorlevel 1 goto EXT_PRESENT
echo Instalando la extension oficial containerapp de Azure CLI...
call az extension add --name containerapp --yes
if errorlevel 1 goto EXTENSION_ERROR
goto EXT_DONE

:EXT_PRESENT
echo [OK] La extension containerapp ya esta instalada. Se reutiliza para evitar cambios entre despliegues.
call az extension show --name containerapp --query version --output tsv

:EXT_DONE

echo.
echo Docker local no es necesario: las imagenes publicas GHCR las compila GitHub Actions.
echo El asistente permite reutilizar el perfil anterior o revisar la configuracion.
echo Antes de desplegar, publica los tres paquetes y comprueba que sean Public; no se crea ACR.
echo La configuracion se guarda en builds\deploy-profile.json para reutilizarla en futuras ejecuciones.
echo Las credenciales se guardan cifradas con Windows DPAPI y no se suben al repo.
echo.
%PYTHON% tools\deploy_azure.py
set "DEPLOY_RC=%ERRORLEVEL%"
if not "%DEPLOY_RC%"=="0" (
  echo.
  echo El despliegue termino con errores. Lee el mensaje anterior y revisa la guia.
  pause
  exit /b %DEPLOY_RC%
)
echo.
echo Flujo terminado. Revisa las URLs, el estado y las advertencias de costo mostradas arriba.
pause
exit /b 0

:NO_AZURE
echo [FALTA] Azure CLI. Instalala desde https://aka.ms/installazurecliwindows
echo Luego vuelve a ejecutar este BAT para iniciar sesion y desplegar.
pause
exit /b 2

:NO_SQL_CLIENT
echo [FALTA] un cliente SQL. Instala psql, o instala Node.js y las dependencias ejecutando npm ci en backend-nest.
echo No hace falta instalar ni ejecutar un servidor PostgreSQL local.
pause
exit /b 2

:NO_PYTHON
echo [FALTA] Python 3. Instala Python 3 y vuelve a ejecutar este BAT.
pause
exit /b 2

:PYTHON_TOO_OLD
echo [FALTA] El asistente requiere Python 3.10 o superior.
pause
exit /b 2

:LOGIN_ERROR
echo [ERROR] No se pudo abrir una sesion Azure valida. Ejecuta az login y revisa tu suscripcion.
pause
exit /b 2

:EXTENSION_ERROR
echo [ERROR] No se pudo instalar la extension containerapp de Azure CLI.
echo Guardando el registro detallado en builds\az-extension-debug.txt
if not exist builds mkdir builds
call az extension add --name containerapp --yes --debug > builds\az-extension-debug.txt 2>&1
echo ---- ultimas lineas del registro ----
powershell -NoProfile -Command "Get-Content -LiteralPath 'builds\az-extension-debug.txt' -Tail 30"
echo -------------------------------------
echo Si el registro menciona maturin, casi seguro usas Azure CLI de 32 bits.
echo Desinstala Microsoft Azure CLI 32 bits e instala la de 64 bits: https://aka.ms/installazurecliwindowsx64
echo Otras causas: Azure CLI desactualizado, proxy, VPN o antivirus que bloquean pip, o falta de espacio.
echo Si sigue fallando, copia las lineas de arriba para diagnosticarlo.
pause
exit /b 2
