@echo off
title InstaPilot AI - Launcher
color 0A

echo.
echo  ================================================================
echo    INSTAPILOT AI  ^|  Starting All Services
echo    Autonomous AI Instagram + YouTube content engine
echo  ================================================================
echo.

:: ── Load config from .env (optional) ──────────────────────────────────────────
:: To expose your local server to Meta webhooks you can use ngrok. Set these in
:: your environment (or a local .env) — NONE are committed/shipped:
::   set NGROK_AUTHTOKEN=<your ngrok authtoken>
::   set NGROK_STATIC_DOMAIN=<your-reserved-domain>.ngrok-free.dev   (optional)
:: Leave them unset to skip the tunnel and just run the app locally.

:: ── Step 1: Check Docker ─────────────────────────────────────────────────────
echo  [1/5] Checking Docker Desktop...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Docker is not running!
    echo          Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)
echo  [OK] Docker is running.
echo.

:: ── Step 2: Start PostgreSQL (+ Redis) ───────────────────────────────────────
echo  [2/5] Starting PostgreSQL + Redis...
docker compose up -d postgres redis >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Failed to start Docker services. Check docker-compose.yml.
    pause
    exit /b 1
)
echo  [OK] PostgreSQL and Redis containers started.
echo.

:: ── Step 3: Wait for PostgreSQL to be ready ──────────────────────────────────
echo  [3/5] Waiting for PostgreSQL to be ready...
:wait_db
docker exec instapilot-postgres pg_isready -U instapilot -d instapilot_db >nul 2>&1
if %errorlevel% neq 0 (
    echo         ... still waiting for database...
    timeout /t 3 /nobreak >nul
    goto wait_db
)
echo  [OK] PostgreSQL is ready.
echo.

:: ── Step 4: Generate Prisma Client + Push Schema ──────────────────────────────
echo  [4/5] Preparing database...
call npx prisma generate >nul 2>&1
call npx prisma db push --accept-data-loss >nul 2>&1
echo  [OK] Prisma client generated and schema synced.
echo.

:: ── Step 5: Start Next.js Dev Server ─────────────────────────────────────────
echo  [5/5] Starting InstaPilot AI dashboard...
start "InstaPilot - Dashboard" cmd /k "color 0D && title InstaPilot AI Dev Server && echo. && echo  InstaPilot AI is starting... && echo  Open: http://localhost:3000 && echo. && npm run dev"
echo  [OK] Next.js dev server starting...
echo.

:: ── Optional: ngrok tunnel for Meta webhooks ─────────────────────────────────
if "%NGROK_AUTHTOKEN%"=="" (
    echo  [i] NGROK_AUTHTOKEN not set - skipping public tunnel.
    echo      Set NGROK_AUTHTOKEN ^(and optionally NGROK_STATIC_DOMAIN^) to expose
    echo      http://localhost:3000 to Meta for real-time webhooks.
) else (
    echo  Starting ngrok tunnel for Meta webhooks...
    powershell -Command "Stop-Process -Name ngrok -Force -ErrorAction SilentlyContinue" >nul 2>&1
    ngrok config add-authtoken %NGROK_AUTHTOKEN% >nul 2>&1
    if "%NGROK_STATIC_DOMAIN%"=="" (
        start "InstaPilot - ngrok Tunnel" cmd /k "title InstaPilot ngrok Tunnel && ngrok http 3000"
    ) else (
        start "InstaPilot - ngrok Tunnel" cmd /k "title InstaPilot ngrok Tunnel && echo Webhook URL: https://%NGROK_STATIC_DOMAIN%/api/webhooks/instagram && ngrok http --url=%NGROK_STATIC_DOMAIN% 3000"
    )
)
echo.

echo  Waiting 12 seconds for Next.js to compile...
timeout /t 12 /nobreak >nul
echo  Opening InstaPilot AI in browser...
start http://localhost:3000
echo.

echo  ================================================================
echo.
echo    InstaPilot AI is running!
echo.
echo    Dashboard   :  http://localhost:3000
echo    PostgreSQL  :  localhost:5432  (instapilot_db)
echo    Redis       :  localhost:6379
echo.
echo    Meta webhook path:  /api/webhooks/instagram
echo    Verify token     :  value of WEBHOOK_VERIFY_TOKEN in your .env
echo.
echo    To stop:
echo      - Close the terminal windows (dashboard + tunnel)
echo      - Run: docker compose down
echo.
echo  ================================================================
echo.
pause
