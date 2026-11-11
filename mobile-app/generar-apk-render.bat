@echo off
setlocal EnableExtensions
rem Alias de compatibilidad: usa el flujo oficial Azure + Neon.
call "%~dp0generar-apk-azure.bat" %*
exit /b %ERRORLEVEL%
