import path from 'path';
import dotenv from 'dotenv';

// Load environment variables — override: true ensures .env always wins over
// any existing system-level environment variables with the same name.
dotenv.config({ path: path.resolve(__dirname, '../../config/env/.env'), override: true });

export const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUserIds: process.env.TELEGRAM_ALLOWED_USER_IDS
      ? process.env.TELEGRAM_ALLOWED_USER_IDS.split(',').map((id) => id.trim())
      : [],
  },
  ollama: {
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3.1',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  security: {
    commandTimeout: parseInt(process.env.COMMAND_TIMEOUT || '30000', 10),
    allowedPaths: process.env.ALLOWED_PATHS
      ? process.env.ALLOWED_PATHS.split(',').map((p) => p.trim())
      : [],
    requireConfirmation: process.env.REQUIRE_CONFIRMATION === 'true',
  },
} as const;
