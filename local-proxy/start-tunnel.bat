@echo off
title EchoLearn Proxy + Tunnel
echo.
echo   EchoLearn Proxy + Cloudflare Tunnel
echo   ====================================
echo.

cd /d "%~dp0"

:: Check if node_modules exists
if not exist "node_modules" (
    echo   Installing dependencies...
    call npm install
    echo.
)

:: Check if cloudflared is available
where cloudflared >nul 2>&1
if %errorlevel% neq 0 (
    echo   cloudflared not found!
    echo   Install it: winget install Cloudflare.cloudflared
    echo.
    echo   Starting proxy without tunnel (localhost only)...
    node server.js
) else (
    echo   Starting proxy + tunnel...
    echo.
    node launch.js
)
pause
