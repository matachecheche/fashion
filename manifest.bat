@echo off
setlocal EnableExtensions
rem FashionStore: prueba los filtros, genera el manifiesto SHA-256 y el ZIP.
cd /d "%~dp0"
python -m unittest discover -s tools -p "test_packaging.py" -v
if errorlevel 1 exit /b %ERRORLEVEL%
python tools\paquetizar_proyecto.py
if errorlevel 1 exit /b %ERRORLEVEL%
python tools\verificar_manifiesto.py --zip
exit /b %ERRORLEVEL%
