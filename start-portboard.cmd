@echo off
setlocal
cd /d "%~dp0"
node scripts\launch.mjs
if errorlevel 1 (
  echo.
  echo Portboard stopped with an error. Press any key to close this window.
  pause >nul
)
