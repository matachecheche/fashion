@echo off
setlocal EnableExtensions
rem ============================================================
rem  FASHIONSTORE - Build de produccion local (sin desplegar)
rem  Genera: backend dist/, frontend dist/, mobile dist/
rem ============================================================
cd /d "%~dp0"
echo [1/3] NestJS...
cd backend-nest && call npm ci --legacy-peer-deps && call npm run build || goto fail
cd ..
echo [2/3] Frontend Web (Vite build)...
cd frontend-web && call npm ci --legacy-peer-deps && call npm run build || goto fail
cd ..
echo [3/3] Mobile (expo export Android + iOS)...
cd mobile-app && call npm ci --legacy-peer-deps && set CI=1 && call npx expo export --platform android --platform ios --output-dir dist || goto fail
cd ..
echo.
echo Build local OK:
echo   backend-nest\dist
echo   frontend-web\dist
echo   mobile-app\dist
echo Nada fue desplegado. Para publicar sigue las guias en docs/ y README.md.
exit /b 0
:fail
cd "%~dp0"
echo [ERROR] Build fallido.
exit /b 1
