@echo off
setlocal EnableExtensions
rem ============================================================
rem  FASHIONSTORE - Resetear base de datos demo (DESTRUCTIVO)
rem  Borra la base 'fashionstore' y la recrea con datos de ejemplo (modo fabrica: es el comportamiento por defecto de iniciar.py).
rem  Requiere PostgreSQL local y el stack apagado.
rem ============================================================
cd /d "%~dp0"
where python >nul 2>&1 || (echo [ERROR] Python no encontrado & exit /b 2)
python iniciar.py --native
exit /b %ERRORLEVEL%
