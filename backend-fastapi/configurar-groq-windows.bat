@echo off
setlocal EnableExtensions
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configurar-groq.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
exit /b %EXIT_CODE%
