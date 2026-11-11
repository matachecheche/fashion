@echo off
setlocal EnableExtensions
rem ============================================================
rem  FASHIONSTORE - Detener servicios locales
rem ============================================================
cd /d "%~dp0"
where docker >nul 2>&1
if errorlevel 1 goto native_stack
docker info >nul 2>&1
if errorlevel 1 goto native_stack
if not exist "%~dp0builds\.env.docker" goto no_docker_env
echo Deteniendo stack Docker...
docker compose --env-file "%~dp0builds\.env.docker" down
exit /b %ERRORLEVEL%

:no_docker_env
echo [AVISO] No existe builds\.env.docker; no se resolvio el stack Docker.

:native_stack
echo Si iniciaste con iniciar.bat (modo nativo), cierra Ctrl+C en esa ventana.
echo Si quieres forzar: cierra las ventanas "FashionStore Stack" o ejecuta:
echo   taskkill /F /IM node.exe /T
echo   taskkill /F /IM python.exe /T   (CUIDADO: cierra TODOS los python del usuario)
exit /b 0
