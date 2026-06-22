@echo off
title EchoLearn Local Proxy
echo.
echo   EchoLearn Local YouTube Transcript Proxy
echo   ========================================
echo.

cd /d "%~dp0"

:: Check if node_modules exists
if not exist "node_modules" (
    echo   Installing dependencies...
    call npm install
    echo.
)

echo   Starting local proxy server...
echo.
node server.js
pause
