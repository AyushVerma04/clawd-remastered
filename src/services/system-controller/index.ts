import os from 'os';
import path from 'path';
import { AICommand, ExecutionResult, TaskPlan } from '../../shared/types';
import logger from '../../shared/logger';
import appLauncher from '../../modules/app-launcher';
import fileManager from '../../modules/file-manager';
import browserController from '../../modules/browser-controller';
import commandRunner from '../../modules/command-runner';
import systemMonitor from '../../modules/system-monitor';
import emailSender from '../../modules/email-sender';
import screenAnalyzer from '../../modules/screen-analyzer';
import notionClient from '../../modules/notion-client';
import githubManager from '../../modules/github-manager';
import aiEngine, { SessionContext } from '../ai-engine';
import groqEngine from '../groq-engine';
import taskPlanner from '../task-planner';
import memoryService from '../memory';

/**
 * System Controller Service
 * Central orchestrator: AI parsing → task planning → execution.
 * Maintains per-chat session context for follow-up queries.
 */
export class SystemController {
  private sessions = new Map<string, SessionContext>();

  getContext(sessionId: string): SessionContext {
    return this.sessions.get(sessionId) || {};
  }

  updateContext(sessionId: string, update: Partial<SessionContext>): void {
    const current = this.sessions.get(sessionId) || {};
    this.sessions.set(sessionId, { ...current, ...update });
  }

  async processMessage(
    message: string,
    sessionId: string = 'default',
    onProgress?: (update: string) => void
  ): Promise<string> {
    try {
      logger.info('Analyzing request...');
      onProgress?.('🧠 Analyzing your request...');

      const context = this.getContext(sessionId);
      const command = await aiEngine.parseIntent(message, context);

      if (command.action === 'chat') {
        if (typeof command.params.reply === 'string') {
          return command.params.reply;
        }
        const answer = await aiEngine.chat(command.params.question as string);
        return answer.trim();
      }

      if (command.action === 'unknown') {
        return `❓ I wasn't able to understand that. Could you rephrase?\n\nYou said: "${message}"`;
      }

      const plan = taskPlanner.createPlan(command, message);
      logger.info(taskPlanner.summarizePlan(plan));

      const results = await this.executePlan(plan, sessionId);
      return this.buildResponse(plan, results);
    } catch (error: unknown) {
      const msg = (error as Error).message;
      logger.error(`Error processing message: ${msg}`);
      return `⚠️ An error occurred: ${msg}`;
    }
  }

  private async executePlan(plan: TaskPlan, sessionId: string): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    plan.status = 'in_progress';
    let generatedContent = '';

    for (const step of plan.steps) {
      step.status = 'in_progress';
      logger.info(`Step ${step.order}: ${step.description}`);

      try {
        if (
          step.command.params.content &&
          typeof step.command.params.content === 'string' &&
          step.command.params.content.includes('{{generated}}')
        ) {
          step.command.params.content = generatedContent;
        }

        const result = await this.executeCommand(step.command, sessionId);
        results.push(result);

        if (result.success) {
          step.status = 'completed';
          step.result = result.message;
          if (step.command.action === 'generate_content' && result.data) {
            generatedContent = result.data as string;
          }
        } else {
          step.status = 'failed';
          step.error = result.message;
        }
      } catch (error: unknown) {
        step.status = 'failed';
        step.error = (error as Error).message;
        results.push({ success: false, message: step.error });
      }
    }

    plan.status = plan.steps.every((s) => s.status === 'completed') ? 'completed' : 'failed';
    return results;
  }

  private async executeCommand(command: AICommand, sessionId: string): Promise<ExecutionResult> {
    const p = command.params;

    switch (command.action) {
      case 'open_app': {
        const args = typeof p.args === 'string' ? p.args : undefined;
        return appLauncher.launch(p.app as string, args);
      }

      case 'open_file':
        return fileManager.openInOS(p.path as string);

      case 'open_folder':
        return fileManager.openInOS(p.path as string);

      case 'open_browser': {
        const browser = p.browser as string | undefined;
        const url = browserController.resolveWebsite(p.url as string) || (p.url as string);
        return browserController.openUrl(url, browser);
      }

      case 'search_web':
        return browserController.search(p.query as string, p.browser as string | undefined);

      case 'create_file':
      case 'write_file': {
        const filePath = p.path as string;
        const result = await fileManager.writeFile(filePath, p.content as string);
        if (result.success) {
          const resolved = fileManager.resolvePath(filePath);
          this.updateContext(sessionId, { lastCreatedFile: resolved, lastAction: 'write_file' });
        }
        return result;
      }

      case 'read_file':
        return fileManager.readFile(p.path as string);

      case 'delete_file':
        return fileManager.deleteFile(p.path as string);

      case 'run_command':
        return commandRunner.execute(p.command as string, p.cwd as string | undefined);

      case 'clone_repo': {
        const repoUrl = p.url as string;
        const dest = p.destination as string | undefined;
        const result = await githubManager.cloneRepo(repoUrl, dest);
        if (result.success && result.data) {
          const cloneDir = (result.data as { path: string }).path;
          this.updateContext(sessionId, { lastFolder: cloneDir, lastAction: 'clone_repo' });
        }
        return result;
      }

      case 'generate_content': {
        const topic = p.topic as string;
        const lines = typeof p.lines === 'number' ? p.lines : 10;
        try {
          const content = await aiEngine.generateContent(topic, lines);
          return { success: true, message: 'Content generated', data: content };
        } catch (error: unknown) {
          return { success: false, message: `Failed to generate content: ${(error as Error).message}` };
        }
      }

      // ─── NEW ACTIONS ──────────────────────────────────────────────────────

      case 'search_and_clone': {
        const query = p.query as string;
        const destination = p.destination as string | undefined;
        const language = p.language as string | undefined;

        if (!query) return { success: false, message: 'search_and_clone requires a "query" param.' };

        const result = await githubManager.searchAndClone(query, destination, language);
        if (result.success && result.data) {
          const cloneDir = (result.data as { path: string }).path;
          this.updateContext(sessionId, { lastFolder: cloneDir, lastAction: 'search_and_clone' });
        }
        return result;
      }

      case 'open_in_editor': {
        const targetPath = (p.path as string) || (this.getContext(sessionId).lastFolder as string);
        const editor = (p.editor as string) || 'vscode';

        if (!targetPath) return { success: false, message: 'open_in_editor requires a "path" param.' };
        return appLauncher.openInEditor(targetPath, editor);
      }

      case 'git_deploy': {
        const localPath = (p.path as string) || (this.getContext(sessionId).lastFolder as string);
        const repoName = p.repo_name as string;
        const isPrivate = p.is_private === true;

        if (!localPath) return { success: false, message: 'No local project path specified for git_deploy.' };
        if (!repoName) return { success: false, message: 'No repo_name specified for git_deploy.' };

        return githubManager.deployToGitHub(localPath, repoName, isPrivate);
      }

      case 'system_health':
        return systemMonitor.getHealth();

      case 'send_email': {
        const to = p.to as string;
        const subject = (p.subject as string) || 'Message from Clawd';
        const body = p.body as string;

        if (!to || !body) return { success: false, message: 'send_email requires "to" and "body" params.' };
        return emailSender.send(to, subject, body);
      }

      case 'analyze_screen': {
        if (!groqEngine.isAvailable) {
          return { success: false, message: 'Screen analysis requires Groq API (vision model). Set GROQ_API_KEY in .env.' };
        }
        const question = (p.question as string) || 'Identify any errors, warnings, or problems visible on screen';
        return screenAnalyzer.captureAndAnalyze(question, (b64, q) => groqEngine.analyzeImage(b64, q));
      }

      case 'notion_create': {
        const title = (p.title as string) || 'Untitled';
        const content = (p.content as string) || '';
        return notionClient.createPage(title, content);
      }

      case 'notion_search':
        return notionClient.searchPages(p.query as string);

      case 'notion_append':
        return notionClient.appendToPage(p.page_id as string, p.content as string);

      case 'remember_fact': {
        const key = p.key as string;
        const value = p.value as string;
        if (!key || !value) return { success: false, message: 'remember_fact requires "key" and "value".' };
        await memoryService.remember(key, value);
        return { success: true, message: `🧠 Remembered: *${key}* = ${value}` };
      }

      case 'recall_fact': {
        const key = p.key as string;
        if (!key) return { success: false, message: 'recall_fact requires a "key".' };
        if (key === 'all') {
          const all = await memoryService.getAllFormatted();
          return { success: true, message: `🧠 *Memory:*\n${all}` };
        }
        const value = await memoryService.recall(key);
        if (value === null) return { success: true, message: `I don't have anything stored for "${key}".` };
        return { success: true, message: `🧠 *${key}*: ${value}` };
      }

      default:
        return { success: false, message: `Unknown action: ${command.action}` };
    }
  }

  private buildResponse(plan: TaskPlan, results: ExecutionResult[]): string {
    const allSuccess = results.every((r) => r.success);
    const lines: string[] = [allSuccess ? '✅ Done!' : '⚠️ Completed with some issues:', ''];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const result = results[i];
      const icon = result?.success ? '✅' : '❌';
      lines.push(`${icon} ${step.description}`);
      if (!result?.success && result?.message) {
        lines.push(`   → ${result.message}`);
      }
    }

    return lines.join('\n');
  }
}

export default new SystemController();
