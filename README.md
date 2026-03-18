# Project Axiom

A **fully local AI automation assistant** controlled through **Telegram**, powered by **Ollama + Llama 3.1**. It runs entirely on your computer, can launch apps, manage files, browse the web, clone repos, and execute multi-step tasks — all from a Telegram chat.

---

## Architecture

```
┌──────────────────┐
│  Telegram Chat    │
└────────┬─────────┘
         │ messages
┌────────▼─────────┐
│  Telegram Bot     │  ← receives commands, sends responses
│  Service          │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  AI Engine        │  ← Ollama / Llama 3.1
│  (Intent Parser)  │     converts NL → structured JSON
└────────┬─────────┘
         │
┌────────▼─────────┐
│  Task Planner     │  ← breaks commands into ordered steps
└────────┬─────────┘
         │
┌────────▼─────────┐
│ System Controller │  ← orchestrates execution
├──────────────────┤
│ ┌──────────────┐ │
│ │ App Launcher │ │  → open installed applications
│ ├──────────────┤ │
│ │ File Manager │ │  → read/write/delete files & folders
│ ├──────────────┤ │
│ │ Browser Ctrl │ │  → open URLs, web search
│ ├──────────────┤ │
│ │ Command Run  │ │  → execute shell commands safely
│ └──────────────┘ │
└──────────────────┘
```

---

## Features

| Feature | Description |
|---|---|
| **App Launcher** | Open any installed application by name (VS Code, Chrome, Spotify, etc.) |
| **File System** | Create, read, write, delete files and folders with path validation |
| **Browser Control** | Open URLs, search the web, resolve well-known sites |
| **Shell Commands** | Execute shell commands with whitelist/blacklist security |
| **Git Automation** | Clone repositories and open them in editors |
| **Content Generation** | Generate text content using Llama 3.1 and save to files |
| **Multi-Step Tasks** | Chain multiple actions into a single automated workflow |
| **Telegram Interface** | Full control via Telegram bot with progress updates |

---

## Prerequisites

- **Node.js** 18+
- **Ollama** — [Install from ollama.com](https://ollama.com)
- **Llama 3.1** model — `ollama pull llama3.1`
- **Telegram Bot Token** — [Create a bot via @BotFather](https://t.me/BotFather)
- **Docker** (optional) — for containerized deployment

---

## Quick Start

### 1. Clone & Install

```bash
git clone <your-repo-url> clawd
cd clawd
npm install
```

### 2. Configure

Copy the example env file and set your Telegram bot token:

```bash
cp config/env/.env.example config/env/.env
```

Edit `config/env/.env`:

```env
TELEGRAM_BOT_TOKEN=your_actual_token_here
TELEGRAM_ALLOWED_USER_IDS=123456789    # optional: restrict to your user ID
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.1
```

### 3. Start Ollama

```bash
ollama serve
# In another terminal:
ollama pull llama3.1
```

### 4. Run

```bash
npm run build
npm start
```

Or in development mode:

```bash
npm run dev
```

### 5. Talk to your bot

Open Telegram, find your bot, and send:

- "Open VS Code"
- "Open LeetCode in Chrome"
- "Clone https://github.com/user/repo and open it in VS Code"
- "Write 10 lines about AI in a text file"
- "Open my downloads folder"

---

## Docker Deployment

```bash
# Start everything (Ollama + Clawd app)
npm run docker:up

# View logs
npm run docker:logs

# Stop
npm run docker:down
```

> **Note:** If you don't have an NVIDIA GPU, the `docker-compose.override.yml` file removes the GPU requirement automatically.

---

## Project Structure

```
clawd/
├── config/
│   └── env/
│       ├── .env               ← your local config (git-ignored)
│       └── .env.example        ← template
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── docker-compose.override.yml
├── scripts/
│   ├── setup.sh               ← Linux/Mac setup
│   └── setup.bat              ← Windows setup
├── src/
│   ├── config/
│   │   └── index.ts            ← loads environment config
│   ├── modules/
│   │   ├── app-launcher/       ← launch desktop applications
│   │   ├── browser-controller/ ← open URLs and search
│   │   ├── command-runner/     ← execute shell commands safely
│   │   └── file-manager/       ← file system operations
│   ├── services/
│   │   ├── ai-engine/          ← Ollama Llama 3.1 integration
│   │   ├── security/           ← command & path validation
│   │   ├── system-controller/  ← central orchestrator
│   │   ├── task-planner/       ← break commands into steps
│   │   └── telegram-bot/       ← Telegram bot interface
│   ├── shared/
│   │   ├── logger.ts           ← Winston logger
│   │   ├── types.ts            ← TypeScript interfaces
│   │   └── index.ts
│   └── index.ts                ← main entry point
├── package.json
├── tsconfig.json
└── README.md
```

---

## Telegram Commands

| Command | Description |
|---|---|
| `/start` | Welcome message |
| `/help` | Show available commands |
| `/status` | Check Ollama & system health |
| `/apps` | List registered applications |
| *any text* | Natural language task execution |

---

## Security

This assistant executes real commands on your computer. Built-in safeguards include:

- **Command blacklist** — blocks destructive patterns (`rm -rf /`, `format C:`, `shutdown`, etc.)
- **Command whitelist** — common safe commands are pre-approved
- **Path validation** — restricts file access to allowed directories
- **URL validation** — blocks local/internal network access (prevents SSRF)
- **User authorization** — optionally restrict the bot to specific Telegram user IDs
- **Execution timeout** — all commands have a configurable timeout limit

> **Important:** Always set `TELEGRAM_ALLOWED_USER_IDS` in production to restrict access to your Telegram user ID only.

---

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Your Telegram bot API token (required) |
| `TELEGRAM_ALLOWED_USER_IDS` | *(empty = open)* | Comma-separated Telegram user IDs |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `llama3.1` | Ollama model name |
| `PORT` | `3000` | Health check API port |
| `NODE_ENV` | `development` | Environment mode |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `COMMAND_TIMEOUT` | `30000` | Max command runtime (ms) |
| `ALLOWED_PATHS` | `C:\Users` | Allowed file system paths |
| `REQUIRE_CONFIRMATION` | `true` | Confirm risky actions |

---

## Extending

### Add a new application

Edit the app registry in `src/modules/app-launcher/index.ts`:

```ts
appLauncher.registerApp({
  name: 'My App',
  aliases: ['myapp', 'my application'],
  command: 'start myapp',
});
```

### Add a new action type

1. Add the type to `src/shared/types.ts` → `ActionType`
2. Add handling logic in `src/services/system-controller/index.ts` → `executeCommand()`
3. Update the AI system prompt in `src/services/ai-engine/index.ts`

---

## License

MIT
