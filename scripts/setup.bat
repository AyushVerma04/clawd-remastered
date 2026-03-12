@echo off
REM ─── Clawd AI Assistant — Windows Setup Script ─────────────────────────────
REM This script sets up the project and verifies prerequisites.

echo ═══════════════════════════════════════════
echo   Clawd AI Assistant — Setup
echo ═══════════════════════════════════════════

REM Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js is not installed. Please install Node.js 18+ first.
    exit /b 1
)
for /f "tokens=1 delims=." %%a in ('node -v') do set NODE_VER=%%a
echo ✅ Node.js found

REM Check npm
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ npm is not installed.
    exit /b 1
)
echo ✅ npm found

REM Check Docker
where docker >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo ✅ Docker found
) else (
    echo ⚠️  Docker not found (optional)
)

REM Check Ollama
where ollama >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo ✅ Ollama found
    echo Checking for llama3.1 model...
    ollama list | findstr "llama3.1" >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo ⚠️  llama3.1 model not found. Pulling it now...
        ollama pull llama3.1
    ) else (
        echo ✅ llama3.1 model available
    )
) else (
    echo ⚠️  Ollama not found. Install from https://ollama.com
)

REM Install dependencies
echo.
echo 📦 Installing dependencies...
call npm install

REM Create .env if missing
if not exist "config\env\.env" (
    copy "config\env\.env.example" "config\env\.env"
    echo 📝 Created config\env\.env — set your TELEGRAM_BOT_TOKEN
)

REM Create logs directory
if not exist "logs" mkdir logs

REM Build
echo.
echo 🔨 Building project...
call npm run build

echo.
echo ═══════════════════════════════════════════
echo   Setup complete!
echo.
echo   Next steps:
echo   1. Edit config\env\.env and set your TELEGRAM_BOT_TOKEN
echo   2. Make sure Ollama is running: ollama serve
echo   3. Start the assistant: npm start
echo ═══════════════════════════════════════════
