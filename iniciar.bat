@echo off
setlocal EnableExtensions
rem ============================================================
rem  FASHIONSTORE - Iniciar el stack local (modo web)
rem  Llama a iniciar.py (auto: Docker si existe, si no nativo).
rem  Requiere Python 3.10+ instalado.
rem ============================================================
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  where py >nul 2>&1 && (py -3 iniciar.py %* & exit /b %ERRORLEVEL%)
  echo [ERROR] Python 3.10+ no esta en el PATH. Instala Python o usa iniciar-docker.bat
  exit /b 2
)
python iniciar.py %*
exit /b %ERRORLEVEL%
