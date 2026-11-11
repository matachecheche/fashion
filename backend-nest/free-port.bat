@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

set "PORT=%~1"
if "%PORT%"=="" set "PORT=3000"

echo %PORT%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo [ERROR] Puerto invalido: "%PORT%". Debe ser un numero entre 1 y 65535.
  exit /b 2
)

set "FOUND_PID="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  if not "%%a"=="0" (
    set "FOUND_PID=%%a"
  )
)

if "%FOUND_PID%"=="" (
  echo [INFO] El puerto %PORT% ya se encuentra libre.
  exit /b 0
)

echo [INFO] Liberando puerto %PORT% ocupado por PID %FOUND_PID%...
taskkill /F /PID %FOUND_PID% >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se pudo terminar el proceso con PID %FOUND_PID% en el puerto %PORT%.
  exit /b 1
)

echo [OK] Puerto %PORT% liberado correctamente (PID %FOUND_PID% finalizado).
exit /b 0
