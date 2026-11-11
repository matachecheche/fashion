@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem ============================================================================
rem  FASHIONSTORE_AUTONOMO.bat — Extractor/arranque autónomo del proyecto
rem
rem  Qué hace (SIN magia y SIN tocar produccion):
rem    1) Busca proyecto.zip junto a este .bat (o en su carpeta actual).
rem    2) Lo extrae en una carpeta "FashionStore" junto a este .bat.
rem    3) Verifica la integridad del paquete con python tools\verificar_manifiesto.py
rem       (fallback: continua con aviso si python no esta disponible, pero NO oculta el error).
rem    4) Arranca el stack local con iniciar.bat (modo auto: Docker si responde,
rem       si no nativo). Abre el navegador en http://localhost:5173.
rem
rem  Requisitos minimos: Windows 10/11 o equivalente, Python 3.10+ y, para modo
rem  Docker, Docker Desktop. Sin cuentas EAS no hay APK (ver docs\APK.md).
rem  Este script NO despliega nada a Internet, NO instala suscripciones y NO pide
rem  contrasenas (ni tuyas ni de nadie).
rem ============================================================================

cd /d "%~dp0"
set "SRC=%~f0"
set "ZIP=%~dp0proyecto.zip"
set "DEST=%~dp0FashionStore"

if not exist "%ZIP%" (
  echo [ERROR] No se encuentra proyecto.zip junto a este archivo.
  echo Copia FASHIONSTORE_AUTONOMO.bat y proyecto.zip en la MISMA carpeta.
  exit /b 2
)

echo ==^> Verificando herramientas...
set "PY_CMD="
where python >nul 2>&1 && set "PY_CMD=python"
if "%PY_CMD%"=="" (where py >nul 2>&1 && set "PY_CMD=py -3")
if "%PY_CMD%"=="" (
  echo [ERROR] Python 3.10+ no esta instalado o no esta en el PATH.
  echo Instala Python desde https://www.python.org/downloads/ (marca "Add to PATH").
  exit /b 3
)
echo   OK: %PY_CMD%

echo ==^> Extrayendo %ZIP% en %DEST% ...
if exist "%DEST%\fashionstore" (
  echo   La carpeta FashionStore\fashionstore ya existe; se reutiliza sin borrar datos.
) else (
  %PY_CMD% -c "import os,zipfile,sys; os.makedirs(sys.argv[2], exist_ok=True); zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "%ZIP%" "%DEST%" || (
    echo [ERROR] No se pudo extraer el paquete.
    exit /b 4
  )
)

rem El paquete contiene la carpeta "fashionstore" en la raiz del zip
set "PROJ=%DEST%\fashionstore"
if not exist "%PROJ%" set "PROJ=%DEST%"
if not exist "%PROJ%\iniciar.bat" (
  echo [ERROR] Estructura inesperada del paquete: no encuentro %PROJ%\iniciar.bat
  exit /b 5
)

echo ==^> Verificando integridad (manifest.sha256)...
if exist "%PROJ%\manifest.sha256" (
  %PY_CMD% "%PROJ%\tools\verificar_manifiesto.py" || (
    echo [ERROR] El paquete no paso la verificacion de integridad. No ejecutes nada.
    exit /b 6
  )
) else (
  echo   [AVISO] No hay manifest.sha256 en el paquete; se omite la verificacion.
)

echo ==^> Arrancando el stack local (Web en http://localhost:5173)...
cd /d "%PROJ%"
call iniciar.bat

echo.
echo Si la ventana anterior cerro el stack, los servicios web y API ya no estan activos.
echo Documentacion completa en "%PROJ%\README.md".
exit /b 0
