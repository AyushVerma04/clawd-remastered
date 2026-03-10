#!/usr/bin/env bash
# ─── Clawd AI Assistant — Setup Script ───────────────────────────────────────
# This script sets up the project and verifies prerequisites.

set -e

echo "═══════════════════════════════════════════"
echo "  Clawd AI Assistant — Setup"
echo "═══════════════════════════════════════════"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js is not installed. Please install Node.js 18+ first."
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ is required. Found: $(node -v)"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# Check npm
if ! command -v npm &> /dev/null; then
  echo "❌ npm is not installed."
  exit 1
fi
echo "✅ npm $(npm -v)"

# Check Docker (optional)
if command -v docker &> /dev/null; then
  echo "✅ Docker $(docker -v | cut -d' ' -f3 | tr -d ',')"
else
  echo "⚠️  Docker not found (optional — needed for containerized setup)"
fi

# Check Ollama
if command -v ollama &> /dev/null; then
  echo "✅ Ollama is installed"
  # Check if llama3.1 model is available
  if ollama list | grep -q "llama3.1"; then
    echo "✅ llama3.1 model is available"
  else
    echo "⚠️  llama3.1 model not found. Pulling it now..."
    ollama pull llama3.1
  fi
else
  echo "⚠️  Ollama not found. Please install Ollama from https://ollama.com"
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Create .env if it doesn't exist
if [ ! -f config/env/.env ]; then
  cp config/env/.env.example config/env/.env
  echo "📝 Created config/env/.env — please fill in your TELEGRAM_BOT_TOKEN"
fi

# Create logs directory
mkdir -p logs

# Build
echo ""
echo "🔨 Building project..."
npm run build

echo ""
echo "═══════════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Edit config/env/.env and set your TELEGRAM_BOT_TOKEN"
echo "  2. Make sure Ollama is running: ollama serve"
echo "  3. Start the assistant: npm start"
echo "═══════════════════════════════════════════"
