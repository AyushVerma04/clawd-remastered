import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { config } from '../../config';
import logger from '../../shared/logger';
import systemController from '../system-controller';
import memoryService from '../memory';
import groqEngine from '../groq-engine';
import screenAnalyzer from '../../modules/screen-analyzer';
import systemMonitor from '../../modules/system-monitor';

/**
 * Telegram Bot Service
 * The primary user interface — receives commands from Telegram
 * and dispatches them through the system controller.
 * Supports text, photos (for screen analysis), and all slash commands.
 */
export class TelegramBotService {
  private bot: TelegramBot;
  private allowedUserIds: string[];

  constructor() {
    if (!config.telegram.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set. Please set it in config/env/.env');
    }
    this.bot = new TelegramBot(config.telegram.botToken, { polling: true });
    this.allowedUserIds = config.telegram.allowedUserIds;
    this.registerHandlers();
  }

  // ─── Register all handlers ───────────────────────────────────────────────

  private registerHandlers(): void {
    this.bot.onText(/\/start/, (msg) => {
      if (!this.isAuthorized(msg)) return;
      this.send(msg.chat.id,
        `🤖 *Clawd AI Assistant — JARVIS Mode*\n\n` +
        `I'm your personal AI that can control your computer, generate code, send emails, manage Notion, and much more.\n\n` +
        `*Quick Examples:*\n` +
        `• "Create a tic tac toe game"\n` +
        `• "Open VS Code"\n` +
        `• "Check system health"\n` +
        `• "Send email to boss@company.com about meeting"\n` +
        `• "Create a note in Notion about my project"\n` +
        `• "What's the error on my screen?"\n` +
        `• "Remember my name is Alex"\n` +
        `• "What is my name?"\n\n` +
        `Type /help for all commands.`
      );
    });

    this.bot.onText(/\/help/, (msg) => {
      if (!this.isAuthorized(msg)) return;
      this.send(msg.chat.id,
        `📖 *Clawd Commands*\n\n` +
        `*Slash Commands:*\n` +
        `/start — Welcome\n` +
        `/status — AI & service status\n` +
        `/health — System CPU/RAM/disk\n` +
        `/apps — List registered apps\n` +
        `/memory — Show all remembered facts\n` +
        `/forget <key> — Delete a memory\n` +
        `/clearmemory — Clear all memory\n` +
        `/screen — Screenshot + AI analysis\n` +
        `/groq — Check Groq API status\n` +
        `/help — This message\n\n` +
        `*Natural Language (just type it):*\n` +
        `🖥️ Open apps, websites, folders\n` +
        `🔍 Search the web\n` +
        `💻 Create & scaffold full projects\n` +
        `✏️ Modify existing code files\n` +
        `📁 Read, write, delete files\n` +
        `🚀 Deploy to GitHub\n` +
        `📊 System health monitoring\n` +
        `✉️ Send emails\n` +
        `📝 Create Notion pages\n` +
        `🧠 Remember facts about yourself\n` +
        `📸 Send a photo → AI analyzes errors\n` +
        `⚡ Multi-step autonomous tasks`
      );
    });

    this.bot.onText(/\/status/, async (msg) => {
      if (!this.isAuthorized(msg)) return;
      const aiEngine = (await import('../ai-engine')).default;
      const [ollamaOk, groqOk] = await Promise.all([
        aiEngine.healthCheck(),
        groqEngine.healthCheck(),
      ]);
      this.send(msg.chat.id,
        `🔍 *System Status*\n\n` +
        `• Telegram Bot: ✅ Online\n` +
        `• Ollama (${config.ollama.model}): ${ollamaOk ? '✅ Connected' : '❌ Offline'}\n` +
        `• Groq API: ${groqOk ? '✅ Connected' : config.groq.apiKey ? '❌ Error' : '⚪ Not configured'}\n` +
        `• Email: ${config.email.user ? '✅ Configured' : '⚪ Not configured'}\n` +
        `• Notion: ${config.notion.apiKey ? '✅ Configured' : '⚪ Not configured'}\n` +
        `• GitHub: ${config.github.token ? '✅ Configured' : '⚪ Not configured'}\n` +
        `• Port: ${config.server.port}`
      );
    });

    this.bot.onText(/\/health/, async (msg) => {
      if (!this.isAuthorized(msg)) return;
      await this.bot.sendChatAction(msg.chat.id, 'typing');
      const result = await systemMonitor.getHealth();
      this.send(msg.chat.id, result.message);
    });

    this.bot.onText(/\/apps/, (msg) => {
      if (!this.isAuthorized(msg)) return;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const appLauncher = require('../../modules/app-launcher').default;
      const apps: string[] = appLauncher.listApps();
      this.send(msg.chat.id,
        `📱 *Registered Applications*\n\n${apps.map((a: string) => `• ${a}`).join('\n')}`
      );
    });

    this.bot.onText(/\/memory/, async (msg) => {
      if (!this.isAuthorized(msg)) return;
      const all = await memoryService.getAllFormatted();
      this.send(msg.chat.id, `🧠 *Remembered Facts:*\n\n${all}`);
    });

    this.bot.onText(/\/forget (.+)/, async (msg, match) => {
      if (!this.isAuthorized(msg)) return;
      const key = match?.[1]?.trim();
      if (!key) return;
      const deleted = await memoryService.forget(key);
      this.send(msg.chat.id, deleted ? `🗑️ Forgot: *${key}*` : `No memory found for "${key}"`);
    });

    this.bot.onText(/\/clearmemory/, async (msg) => {
      if (!this.isAuthorized(msg)) return;
      await memoryService.clearAll();
      this.send(msg.chat.id, '🗑️ All memory cleared.');
    });

    this.bot.onText(/\/screen/, async (msg) => {
      if (!this.isAuthorized(msg)) return;
      if (!groqEngine.isAvailable) {
        this.send(msg.chat.id, '❌ Screen analysis requires Groq API. Set GROQ_API_KEY in .env.');
        return;
      }
      await this.bot.sendChatAction(msg.chat.id, 'upload_photo');
      const result = await screenAnalyzer.captureAndAnalyze(
        'Identify any errors, warnings, problems, or important information visible on screen',
        (b64, q) => groqEngine.analyzeImage(b64, q)
      );
      this.send(msg.chat.id, result.message);
    });

    this.bot.onText(/\/groq/, async (msg) => {
      if (!this.isAuthorized(msg)) return;
      if (!config.groq.apiKey) {
        this.send(msg.chat.id, '⚪ Groq API key not configured. Add GROQ_API_KEY to .env.');
        return;
      }
      const ok = await groqEngine.healthCheck();
      this.send(msg.chat.id,
        ok
          ? `✅ Groq API connected\nModel: ${config.groq.model}\nVision: ${config.groq.visionModel}`
          : '❌ Groq API connection failed. Check your GROQ_API_KEY.'
      );
    });

    // ─── Photo handler: analyze images sent by the user ──────────────────────
    this.bot.on('photo', async (msg) => {
      if (!this.isAuthorized(msg)) return;
      if (!groqEngine.isAvailable) {
        this.send(msg.chat.id, '❌ Image analysis requires Groq API. Set GROQ_API_KEY in .env.');
        return;
      }

      await this.bot.sendChatAction(msg.chat.id, 'typing');
      const caption = msg.caption || 'Analyze this image. Identify errors, warnings, or any important information.';

      try {
        // Get the largest photo (last in the array)
        const photo = msg.photo![msg.photo!.length - 1];
        const fileInfo = await this.bot.getFile(photo.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${fileInfo.file_path}`;

        const imageRes = await axios.get<ArrayBuffer>(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });
        const buffer = Buffer.from(imageRes.data);

        const result = await screenAnalyzer.analyzeImageBuffer(
          buffer,
          caption,
          (b64, q, mime) => groqEngine.analyzeImage(b64, q, mime),
          'image/jpeg'
        );
        this.send(msg.chat.id, result.message);
      } catch (err) {
        const errMsg = (err as Error).message;
        logger.error(`Photo analysis error: ${errMsg}`);
        this.send(msg.chat.id, `❌ Failed to analyze image: ${errMsg}`);
      }
    });

    // ─── Catch-all: natural language messages ─────────────────────────────────
    this.bot.on('message', async (msg) => {
      if (msg.text?.startsWith('/')) return;
      if (msg.photo) return; // handled above
      if (!this.isAuthorized(msg)) return;
      if (!msg.text?.trim()) return;

      const chatId = msg.chat.id;
      const sessionId = chatId.toString();

      await this.bot.sendChatAction(chatId, 'typing');

      const response = await systemController.processMessage(msg.text, sessionId);
      this.send(chatId, response);
    });

    this.bot.on('polling_error', (error) => {
      logger.error(`Telegram polling error: ${error.message}`);
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Send a message with Markdown, truncating if too long for Telegram. */
  private send(chatId: number, text: string): void {
    const MAX = 4000;
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, MAX));
      remaining = remaining.slice(MAX);
    }
    for (const chunk of chunks) {
      this.bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch((err: Error) => {
        // Markdown parse error: retry as plain text
        this.bot.sendMessage(chatId, chunk).catch(() => {
          logger.error(`Failed to send message: ${err.message}`);
        });
      });
    }
  }

  private isAuthorized(msg: TelegramBot.Message): boolean {
    if (this.allowedUserIds.length === 0) return true;
    const userId = msg.from?.id?.toString();
    if (!userId || !this.allowedUserIds.includes(userId)) {
      logger.warn(`Unauthorized access from user ${userId} (${msg.from?.username})`);
      this.bot.sendMessage(msg.chat.id, '🚫 You are not authorized to use this bot.');
      return false;
    }
    return true;
  }

  getBot(): TelegramBot { return this.bot; }
  stop(): void { this.bot.stopPolling(); logger.info('Telegram bot stopped'); }
}

export default TelegramBotService;
