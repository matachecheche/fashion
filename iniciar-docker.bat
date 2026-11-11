@echo off
setlocal EnableExtensions
rem ============================================================
rem  FASHIONSTORE - Iniciar stack Docker Compose local
rem  Delegamos a iniciar.py para aplicar el mismo reset de fabrica
rem  (incluido el volumen pgdata) en cualquier punto de entrada.
rem ============================================================
cd /d "%~dp0"
where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker no esta instalado o no esta en el PATH.
  echo Instala Docker Desktop desde https://www.docker.com/products/docker-desktop/
  exit /b 2
)
where python >nul 2>&1
if not errorlevel 1 (
  python iniciar.py --docker %*
  exit /b %ERRORLEVEL%
)
where py >nul 2>&1
if not errorlevel 1 (
  py -3 iniciar.py --docker %*
  exit /b %ERRORLEVEL%
)
echo [ERROR] Python 3.10+ no esta instalado o no esta en el PATH.
echo Instala Python desde https://www.python.org/downloads/ y vuelve a intentar.
exit /b 4
