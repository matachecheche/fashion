@echo off
setlocal EnableExtensions
rem ============================================================
rem  FASHIONSTORE - Diagnostico rapido del entorno
rem ============================================================
cd /d "%~dp0"
set "FAIL=0"
set "PS=powershell -NoProfile -Command"

rem Llamar _check.bat para no duplicar logica no es necesario; inline simple:
echo == Node / npm ==
where node >nul 2>&1 && node -v || (echo   FALTA node & set FAIL=1)
where npm  >nul 2>&1 && npm -v  || (echo   FALTA npm  & set FAIL=1)

echo == Python ==
where python >nul 2>&1 && python --version || (echo   FALTA python & set FAIL=1)

echo == PostgreSQL (puerto 5432) ==
%PS% "$c=New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1',5432); Write-Host '  OK 5432' } catch { Write-Host '  NO RESPONDE 5432' } finally { $c.Close() }"

echo == Memoria libre ==
%PS% "$os=Get-CimInstance Win32_OperatingSystem; Write-Host ('  ' + [math]::Round($os.FreePhysicalMemory/1MB,2) + ' GB libres')"

echo == Servicios ==
for %%S in ("3000/api/health" "8000/api/salud" "5173/") do (
  %PS% "try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:%%~S' -UseBasicParsing -TimeoutSec 4; Write-Host '  OK %%~S -> HTTP ' $r.StatusCode } catch { Write-Host '  APAGADO %%~S' }"
)

echo.
if "%FAIL%"=="1" (echo Resultado: faltan dependencias instaladas & exit /b 1)
echo Resultado: dependencias encontradas. Servicios arriba se muestran arriba.
exit /b 0
