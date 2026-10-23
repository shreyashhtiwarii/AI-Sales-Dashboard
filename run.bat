@echo off
setlocal enabledelayedexpansion
title AI Sales Analytics Dashboard Launcher
color 0A

echo.
echo  ======================================================
echo    AI Sales Analytics Dashboard - Launcher
echo  ======================================================
echo.

:: ── Set project directory paths portably ────────────────────────
set "ROOT_DIR=%~dp0"
set "BACKEND_DIR=%ROOT_DIR%backend"
set "FRONTEND_DIR=%ROOT_DIR%frontend"

:: ── Detect Python executable ────────────────────────────────────
set "PY_CMD=python"
where python >nul 2>&1
if errorlevel 1 (
    where py >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python was not found in PATH!
        echo Please install Python 3.10+ and add it to PATH.
        pause
        exit /b 1
    ) else (
        set "PY_CMD=py"
    )
)

:: ── Detect npm executable ───────────────────────────────────────
set "NPM_CMD=npm"
where npm >nul 2>&1
if errorlevel 1 (
    where npm.cmd >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] npm was not found in PATH!
        echo Please install Node.js (https://nodejs.org) and add it to PATH.
        pause
        exit /b 1
    ) else (
        set "NPM_CMD=npm.cmd"
    )
)

:: ── Check frontend node_modules ─────────────────────────────────
if not exist "%FRONTEND_DIR%\node_modules" (
    echo [*] Frontend dependencies not found. Installing node packages...
    cd /d "%FRONTEND_DIR%"
    call %NPM_CMD% install
    if errorlevel 1 (
        echo [ERROR] npm install failed!
        pause
        exit /b 1
    )
)

:: ── Step 1: Free existing processes on port 8000 and 5173 ───────
echo [1/3] Freeing ports 8000 and 5173...

for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr /r /c:":8000 .*LISTENING"') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr /r /c:":5173 .*LISTENING"') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)

:: Give the OS a moment to release ports
ping 127.0.0.1 -n 3 >nul

:: ── Step 2: Start FastAPI backend ───────────────────────────────
echo [2/3] Starting FastAPI backend on port 8000 (%PY_CMD%)...
start "FastAPI Backend :8000" /D "%BACKEND_DIR%" cmd /k "title FastAPI Backend :8000 && %PY_CMD% main.py"

:: ── Step 3: Start Vite frontend ─────────────────────────────────
echo [3/3] Starting Vite frontend on port 5173 (%NPM_CMD%)...
start "React Frontend :5173" /D "%FRONTEND_DIR%" cmd /k "title React Frontend :5173 && %NPM_CMD% run dev"

:: ── Wait for backend service to become ready ────────────────────
echo     Waiting for AI models and backend to initialize...
set /a ATTEMPTS=0

:WAIT_LOOP
set /a ATTEMPTS+=1
where curl.exe >nul 2>&1
if not errorlevel 1 (
    curl.exe -s --max-time 1 http://127.0.0.1:8000/api/health | findstr "ok" >nul 2>&1
    if not errorlevel 1 (
        echo     Backend ready!
        goto SERVICES_READY
    )
) else (
    powershell -NoProfile -Command "(Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 1 -UseBasicParsing).StatusCode" >nul 2>&1
    if not errorlevel 1 (
        echo     Backend ready!
        goto SERVICES_READY
    )
)

if !ATTEMPTS! geq 12 (
    echo     Proceeding to browser (backend still training in background)...
    goto SERVICES_READY
)
ping 127.0.0.1 -n 2 >nul
goto WAIT_LOOP

:SERVICES_READY
ping 127.0.0.1 -n 2 >nul

:: ── Open browser ────────────────────────────────────────────────
echo.
echo  Opening dashboard at http://127.0.0.1:5173 ...
start http://127.0.0.1:5173

echo.
echo  ======================================================
echo    AI Sales Analytics Dashboard is running!
echo  ======================================================
echo    Dashboard:  http://127.0.0.1:5173
echo    API Docs:   http://127.0.0.1:8000/docs
echo    API Health: http://127.0.0.1:8000/api/health
echo  ======================================================
echo.
echo  Keep the server windows open. Close them to stop.
echo.
pause
