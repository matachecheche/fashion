@echo off
setlocal EnableExtensions
rem ============================================================
rem  FASHIONSTORE - Generar APK (requiere EAS login + setup real)
rem  Delega en mobile-app\build-apk.bat
rem ============================================================
cd /d "%~dp0mobile-app"
call build-apk.bat %*
exit /b %ERRORLEVEL%
