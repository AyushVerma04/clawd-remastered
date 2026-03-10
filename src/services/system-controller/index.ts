import os from 'os';
import path from 'path';
import { AICommand, ExecutionResult, TaskPlan } from '../../shared/types';
import logger from '../../shared/logger';
import appLauncher from '../../modules/app-launcher';
import fileManager from '../../modules/file-manager';
import browserController from '../../modules/browser-controller';
import commandRunner from '../../modules/command-runner';
import aiEngine, { SessionContext } from '../ai-engine';
import taskPlanner from '../task-planner';

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
        const dest = (p.destination as string) || path.basename(repoUrl, '.git');
        const cloneDir = path.join(os.homedir(), dest);
        const result = await commandRunner.execute(`git clone ${repoUrl} "${cloneDir}"`);
        if (result.success) {
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
