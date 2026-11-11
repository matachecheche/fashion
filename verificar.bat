@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem ============================================================
rem  FASHIONSTORE - Verificacion completa del repositorio
rem  No despliega NADA. Compila, typechecks y ejecuta las pruebas.
rem  El test:security de NestJS es aislado; las otras suites
rem  NestJS necesitan API, IA y DB arriba (usa iniciar.bat);
rem  si no estan, se reporta y no se finge que pasaron.
rem ============================================================
cd /d "%~dp0"
set "FAIL=0"
set "API=http://127.0.0.1:3000/api/health"

echo === [1/7] NestJS: npm ci + audit + build + seguridad aislada ===
cd backend-nest && call npm ci --legacy-peer-deps || goto fail
call npm audit --audit-level=moderate || goto fail
call npm run build || goto fail
call npm run test:security || goto fail
cd ..

echo === [2/7] NestJS: tests de integracion (API + IA + DB arriba) ===
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -Uri '%API%' -UseBasicParsing -TimeoutSec 4; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo   [ERROR] %API% no responde. Abre otra ventana y ejecuta: iniciar.bat
  echo   Luego vuelve a correr verificar.bat. Las otras etapas SI se ejecutan.
  set "FAIL=1"
) else (
  cd backend-nest
  call npm run test:smoke || set FAIL=1
  call npm run test:payments || set FAIL=1
  call npm run test:subscription || set FAIL=1
  call npm run test:sync || set FAIL=1
  call npm run test:sync-conflicts || set FAIL=1
  call npm run test:reportes || set FAIL=1
  call npm run test:ia || set FAIL=1
  call npm run test:ml-persistence || set FAIL=1
  cd ..
)

echo === [3/7] FastAPI: pip-audit + pytest ===
if not exist ".venv-ia\Scripts\python.exe" (
  python -m venv ".venv-ia" || goto fail
)
".venv-ia\Scripts\python.exe" -m pip install --disable-pip-version-check -r "backend-fastapi\requirements-dev.txt" || set FAIL=1
".venv-ia\Scripts\python.exe" -m pip_audit --strict --requirement "backend-fastapi\requirements-dev.txt" || set FAIL=1
cd backend-fastapi
"..\.venv-ia\Scripts\python.exe" -m pytest tests -q || set FAIL=1
"..\.venv-ia\Scripts\python.exe" tests\prueba_ia.py || set FAIL=1
cd ..

echo === [4/7] Frontend: audit + build + PWA test ===
cd frontend-web && call npm ci --legacy-peer-deps || goto fail
call npm audit --audit-level=moderate || goto fail
call npm run build || goto fail
call npm test || goto fail
cd ..

echo === [5/7] Mobile: npm ci + typecheck ===
cd mobile-app && call npm ci --legacy-peer-deps || goto fail
call npx tsc --noEmit || goto fail
cd ..

echo === [6/7] Mobile: export Android (bundle estatico) ===
cd mobile-app && set CI=1 && call npx expo export --platform android --output-dir dist || goto fail
cd ..

echo === [7/7] Mobile: auditoria de vulnerabilidades altas ===
cd mobile-app && call npm audit --audit-level=high || goto fail
cd ..

if "%FAIL%"=="1" goto fail
echo.
echo VERIFICACION COMPLETA OK
exit /b 0

:fail
cd "%~dp0"
echo.
echo VERIFICACION FALLIDA - revisa los mensajes de arriba.
exit /b 1
