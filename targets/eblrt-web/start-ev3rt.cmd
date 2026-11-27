@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js 24.
  pause
  exit /b 1
)
node bridge\start-windows.mjs
pause
