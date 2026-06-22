@echo off
title EchoLearn Local Proxy

echo.
echo   EchoLearn Local YouTube Transcript Proxy
echo   ========================================
echo.

cd /d "%~dp0"

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

echo   Starting local proxy server...
echo.
node server.js

:end
echo.
echo   Proxy stopped.
pause
