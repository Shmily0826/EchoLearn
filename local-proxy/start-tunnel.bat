@echo off
title EchoLearn Proxy + Tunnel

echo.
echo   EchoLearn Proxy + Cloudflare Tunnel
echo   ====================================
echo.

cd /d "%~dp0"

:: Add cloudflared install path to PATH (winget install may not refresh PATH for Explorer)
set "PATH=%PATH%;C:\Program Files (x86)\cloudflared;C:\Program Files\cloudflared"

:: Check if node is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js not found!
    echo   Please install Node.js from https://nodejs.org/
    echo.
    goto :done
)

:: Check if node_modules exists
if not exist "node_modules" (
    echo   Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo   [ERROR] npm install failed!
        goto :done
    )
    echo.
)

:: Check if cloudflared is available
where cloudflared >nul 2>&1
if %errorlevel% neq 0 (
    echo   [WARN] cloudflared not found in PATH.
    echo   Install it: winget install Cloudflare.cloudflared
    echo   Then restart this script.
    echo.
    echo   Starting proxy WITHOUT tunnel (localhost only)...
    echo.
    node server.js
) else (
    echo   Starting proxy + tunnel...
    echo.
    node launch.js
)

:done
echo.
echo   Proxy has stopped.
echo.
pause
