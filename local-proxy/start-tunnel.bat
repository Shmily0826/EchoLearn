@echo off
title EchoLearn Proxy and Tunnel

echo.
echo   EchoLearn Proxy and Cloudflare Tunnel
echo   =====================================
echo.

cd /d "%~dp0"

set "CF32=C:\Program Files (x86)\cloudflared"
set "CF64=C:\Program Files\cloudflared"
set "PATH=%PATH%;%CF32%;%CF64%"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js not found!
    echo   Please install from https://nodejs.org/
    goto :end
)

if not exist "node_modules" (
    echo   Installing dependencies...
    call npm install
)

where cloudflared >nul 2>&1
if %errorlevel% equ 0 (
    echo   Starting proxy and tunnel...
    echo.
    node launch.js
    goto :end
)

echo   cloudflared not found, starting proxy only.
echo   Install for tunnel: winget install Cloudflare.cloudflared
echo.
node server.js

:end
echo.
echo   Proxy stopped.
pause
