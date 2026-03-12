import express from 'express';
import { config } from './config';
import logger from './shared/logger';
import TelegramBotService from './services/telegram-bot';
import aiEngine from './services/ai-engine';
import groqEngine from './services/groq-engine';

async function main(): Promise<void> {
  logger.info('═══════════════════════════════════════════════════════');
  logger.info('  Clawd AI Assistant — JARVIS Mode — Starting up...');
  logger.info('═══════════════════════════════════════════════════════');

  // ─── 1. Health-check Express server ───────────────────────────────────────
  const app = express();
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    const [ollamaOk, groqOk] = await Promise.all([
      aiEngine.healthCheck(),
      groqEngine.healthCheck(),
    ]);
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      ollama: ollamaOk ? 'connected' : 'disconnected',
      groq: groqOk ? 'connected' : config.groq.apiKey ? 'error' : 'not_configured',
      model: { ollama: config.ollama.model, groq: config.groq.model },
    });
  });

  app.listen(config.server.port, () => {
    logger.info(`Health API listening on port ${config.server.port}`);
  });

  // ─── 2. Check AI connectivity ──────────────────────────────────────────────
  logger.info('Checking AI services...');

  const ollamaOk = await aiEngine.healthCheck();
  if (ollamaOk) {
    logger.info(`✅ Ollama: running (${config.ollama.model})`);
  } else {
    logger.warn(`⚠️  Ollama offline — run: ollama pull ${config.ollama.model}`);
  }

  if (config.groq.apiKey) {
    const groqOk = await groqEngine.healthCheck();
    if (groqOk) {
      logger.info(`✅ Groq API: connected (${config.groq.model})`);
    } else {
      logger.warn('⚠️  Groq API key set but connection failed — check GROQ_API_KEY');
    }
  } else {
    logger.info('ℹ️  Groq API not configured (set GROQ_API_KEY for code generation, emails, Notion, etc.)');
  }

  if (!ollamaOk && !groqEngine.isAvailable) {
    logger.warn('⚠️  Both Ollama and Groq are unavailable. Rule-based commands still work.');
  }

  // ─── Log optional service status ──────────────────────────────────────────
  logger.info(`📧 Email: ${config.email.user ? `configured (${config.email.user})` : 'not configured'}`);
  logger.info(`📝 Notion: ${config.notion.apiKey ? 'configured' : 'not configured'}`);
  logger.info(`🐙 GitHub: ${config.github.token ? `configured (${config.github.username})` : 'not configured'}`);

  // ─── 3. Start Telegram Bot ────────────────────────────────────────────────
  if (!config.telegram.botToken || config.telegram.botToken === 'your_telegram_bot_token_here') {
    logger.error('Telegram bot token is not configured!');
    logger.error('Set TELEGRAM_BOT_TOKEN in config/env/.env');
    process.exit(1);
  }

  logger.info('Starting Telegram bot...');
  const telegramBot = new TelegramBotService();
  logger.info('✅ Telegram bot listening for messages.');

  // ─── 4. Graceful shutdown ─────────────────────────────────────────────────
  const shutdown = () => {
    logger.info('Shutting down gracefully...');
    telegramBot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('═══════════════════════════════════════════════════════');
  logger.info('  Clawd AI Assistant is READY — JARVIS is online!');
  logger.info('  Send a message to your Telegram bot to get started.');
  logger.info('═══════════════════════════════════════════════════════');
}

main().catch((err) => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});
