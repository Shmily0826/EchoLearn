@echo off
title EchoLearn Local Proxy

echo.
echo   EchoLearn Local YouTube Transcript Proxy
echo   ========================================
echo.

cd /d "%~dp0"

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

echo   Starting local proxy server...
echo.
node server.js

:done
echo.
echo   Proxy has stopped.
echo.
pause
