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

:: Always run from this script's own folder, however it was invoked.
cd /d "%~dp0"

:: ── Step 1: Check Docker ─────────────────────────────────────────────────────
echo  [1/6] Checking Docker Desktop...
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

:: ── Step 2: Node dependencies ────────────────────────────────────────────────
:: First run on a fresh machine (or after node_modules is deleted) installs
:: everything automatically instead of failing later with "next is not recognized".
echo  [2/6] Checking Node dependencies...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Node.js / npm was not found on PATH.
    echo          Install Node 18+ from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
)
if not exist "node_modules" (
    echo        node_modules missing - installing dependencies.
    echo        This can take several minutes on the first run, please wait...
    if exist "package-lock.json" (
        call npm ci --no-audit --no-fund
    ) else (
        call npm install --no-audit --no-fund
    )
    if errorlevel 1 (
        echo  [ERROR] Dependency install failed. Check the output above.
        pause
        exit /b 1
    )
)
echo  [OK] Dependencies are installed.
echo.

:: ── Step 3: Start PostgreSQL (+ Redis) ───────────────────────────────────────
:: Creates the container, user, password and database automatically from
:: docker-compose.yml the first time - nothing to set up by hand.
echo  [3/6] Starting PostgreSQL + Redis...

:: A sibling project (e.g. youtubepilot) may already hold port 5432 with a
:: different Postgres. Only one can own the port, so stand the other one down.
for /f "tokens=*" %%C in ('docker ps --filter "publish=5432" --format "{{.Names}}" 2^>nul') do (
    if not "%%C"=="instapilot-postgres" (
        echo        Port 5432 is held by "%%C" - stopping it so this project can use it.
        docker stop %%C >nul 2>&1
    )
)

docker compose up -d postgres redis >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Failed to start Docker services. Check docker-compose.yml.
    pause
    exit /b 1
)
echo  [OK] PostgreSQL and Redis containers started.
echo.

:: ── Step 4: Wait for PostgreSQL to be ready ──────────────────────────────────
:: Counter lives on its own lines (not inside a parenthesised block) so plain
:: %VAR% expansion works on each re-entry via goto - no delayed expansion needed,
:: which would otherwise swallow the "!" in this script's echo lines.
echo  [4/6] Waiting for PostgreSQL to be ready...
set DB_TRIES=0
:wait_db
docker exec instapilot-postgres pg_isready -U instapilot -d instapilot_db >nul 2>&1
if %errorlevel% equ 0 goto db_ready
set /a DB_TRIES+=1
if %DB_TRIES% geq 40 (
    echo  [ERROR] PostgreSQL did not become ready within 2 minutes.
    echo          Check: docker logs instapilot-postgres
    pause
    exit /b 1
)
echo         ... still waiting for database...
timeout /t 3 /nobreak >nul
goto wait_db
:db_ready
echo  [OK] PostgreSQL is ready.
echo.

:: ── Step 5: Generate Prisma Client + Push Schema ──────────────────────────────
:: NOTE: the Prisma CLI reads .env (NOT .env.local, which Next.js prefers). Both
:: files must carry the same DATABASE_URL or this step silently targets the wrong
:: database and the app starts with no tables.
echo  [5/6] Preparing database...
call npx prisma generate
:: Schema sync should be a deliberate release step, not silently forced. Dropped
:: --accept-data-loss (never auto-drop columns) and surface output so failures are visible.
call npx prisma db push
if errorlevel 1 (
    echo  [ERROR] Schema sync failed - the app would start with no tables.
    echo          Check that DATABASE_URL in .env matches docker-compose.yml.
    pause
    exit /b 1
)
echo  [OK] Prisma client generated and schema synced.
echo.

:: ── Step 6: Start Next.js Dev Server ─────────────────────────────────────────
echo  [6/6] Starting InstaPilot AI dashboard...
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
