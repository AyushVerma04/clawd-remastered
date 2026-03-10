import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../config';
import logger from '../../shared/logger';
import systemController from '../system-controller';

/**
 * Telegram Bot Service
 * The primary user interface — receives commands from Telegram
 * and dispatches them through the system controller.
 */
export class TelegramBotService {
  private bot: TelegramBot;
  private allowedUserIds: string[];

  constructor() {
    if (!config.telegram.botToken) {
      throw new Error(
        'TELEGRAM_BOT_TOKEN is not set. Please set it in config/env/.env'
      );
    }

    this.bot = new TelegramBot(config.telegram.botToken, { polling: true });
    this.allowedUserIds = config.telegram.allowedUserIds;
    this.registerHandlers();
  }

  /** Register all message and command handlers. */
  private registerHandlers(): void {
    // /start command
    this.bot.onText(/\/start/, (msg) => {
      if (!this.isAuthorized(msg)) return;
      this.bot.sendMessage(
        msg.chat.id,
        `🤖 *Clawd AI Assistant*\n\nI'm your local AI automation assistant powered by Ollama + Llama 3.1.\n\nSend me a message and I'll execute it on your computer.\n\n*Examples:*\n• "Open VS Code"\n• "Open LeetCode in Chrome"\n• "Clone this repo and open it in VS Code"\n• "Write 10 lines about AI in a text file"\n• "Open my downloads folder"\n\nType /help for more commands.`,
        { parse_mode: 'Markdown' }
      );
    });

    // /help command
    this.bot.onText(/\/help/, (msg) => {
      if (!this.isAuthorized(msg)) return;
      this.bot.sendMessage(
        msg.chat.id,
        `📖 *Available Commands*\n\n/start — Welcome message\n/help — Show this help\n/status — Check system status\n/apps — List available apps\n\n*Natural Language Tasks:*\n• Open applications\n• Browse websites\n• Create/edit files\n• Run shell commands\n• Clone Git repos\n• Multi-step automation\n\nJust tell me what you want to do!`,
        { parse_mode: 'Markdown' }
      );
    });

    // /status command
    this.bot.onText(/\/status/, async (msg) => {
      if (!this.isAuthorized(msg)) return;
      const aiEngine = (await import('../ai-engine')).default;
      const ollamaOk = await aiEngine.healthCheck();
      this.bot.sendMessage(
        msg.chat.id,
        `🔍 *System Status*\n\n• Telegram Bot: ✅ Online\n• Ollama (${config.ollama.model}): ${ollamaOk ? '✅ Connected' : '❌ Offline'}\n• Server Port: ${config.server.port}`,
        { parse_mode: 'Markdown' }
      );
    });

    // /apps command
    this.bot.onText(/\/apps/, (msg) => {
      if (!this.isAuthorized(msg)) return;
      const appLauncher = require('../../modules/app-launcher').default;
      const apps: string[] = appLauncher.listApps();
      this.bot.sendMessage(
        msg.chat.id,
        `📱 *Registered Applications*\n\n${apps.map((a: string) => `• ${a}`).join('\n')}`,
        { parse_mode: 'Markdown' }
      );
    });

    // Catch-all: natural language messages
    this.bot.on('message', async (msg) => {
      // Skip commands (they're handled above)
      if (msg.text?.startsWith('/')) return;
      if (!this.isAuthorized(msg)) return;
      if (!msg.text) return;

      const chatId = msg.chat.id;
      const sessionId = chatId.toString();

      // Send "thinking" indicator while processing
      await this.bot.sendChatAction(chatId, 'typing');

      // Process the message — no per-step progress callbacks to avoid Telegram message ordering issues
      const response = await systemController.processMessage(msg.text, sessionId);

      // Send final consolidated response
      await this.bot.sendMessage(chatId, response);
    });

    // Error handler
    this.bot.on('polling_error', (error) => {
      logger.error(`Telegram polling error: ${error.message}`);
    });
  }

  /** Check if the user sending the message is authorized. */
  private isAuthorized(msg: TelegramBot.Message): boolean {
    // If no allowed user IDs are configured, allow everyone (open mode)
    if (this.allowedUserIds.length === 0) return true;

    const userId = msg.from?.id?.toString();
    if (!userId || !this.allowedUserIds.includes(userId)) {
      logger.warn(
        `Unauthorized access attempt from user ${userId} (${msg.from?.username})`
      );
      this.bot.sendMessage(
        msg.chat.id,
        '🚫 You are not authorized to use this bot.'
      );
      return false;
    }

    return true;
  }

  /** Get the bot instance (for testing). */
  getBot(): TelegramBot {
    return this.bot;
  }

  /** Stop the bot. */
  stop(): void {
    this.bot.stopPolling();
    logger.info('Telegram bot stopped');
  }
}

export default TelegramBotService;
