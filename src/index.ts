import express from 'express';
import { config } from './config';
import logger from './shared/logger';
import TelegramBotService from './services/telegram-bot';
import aiEngine from './services/ai-engine';

async function main(): Promise<void> {
  logger.info('═══════════════════════════════════════════');
  logger.info('  Clawd AI Assistant — Starting up...');
  logger.info('═══════════════════════════════════════════');

  // ─── 1. Health-check Express server ───────────────────────────────────────
  const app = express();
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    const ollamaOk = await aiEngine.healthCheck();
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      ollama: ollamaOk ? 'connected' : 'disconnected',
      model: config.ollama.model,
    });
  });

  app.listen(config.server.port, () => {
    logger.info(`Health API listening on port ${config.server.port}`);
  });

  // ─── 2. Verify Ollama connectivity ────────────────────────────────────────
  logger.info('Checking Ollama connection...');
  const ollamaOk = await aiEngine.healthCheck();
  if (ollamaOk) {
    logger.info(`Ollama is running with model: ${config.ollama.model}`);
  } else {
    logger.warn(
      'Ollama is not reachable. Make sure Ollama is running and the model is pulled.'
    );
    logger.warn(`Expected host: ${config.ollama.host}`);
    logger.warn(`Run: ollama pull ${config.ollama.model}`);
  }

  // ─── 3. Start Telegram Bot ────────────────────────────────────────────────
  if (!config.telegram.botToken || config.telegram.botToken === 'your_telegram_bot_token_here') {
    logger.error('Telegram bot token is not configured!');
    logger.error('Set TELEGRAM_BOT_TOKEN in config/env/.env');
    process.exit(1);
  }

  logger.info('Starting Telegram bot...');
  const telegramBot = new TelegramBotService();
  logger.info('Telegram bot is now listening for messages.');

  // ─── 4. Graceful shutdown ─────────────────────────────────────────────────
  const shutdown = () => {
    logger.info('Shutting down gracefully...');
    telegramBot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('═══════════════════════════════════════════');
  logger.info('  Clawd AI Assistant is ready!');
  logger.info('  Send a message to your Telegram bot.');
  logger.info('═══════════════════════════════════════════');
}

main().catch((err) => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});
