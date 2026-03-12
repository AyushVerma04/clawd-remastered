import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import { AppRegistryEntry, ExecutionResult } from '../../shared/types';
import logger from '../../shared/logger';

const execAsync = promisify(exec);

/**
 * Application Launcher Module
 * Maintains a registry of known applications and launches them by name.
 */
export class AppLauncher {
  private registry: AppRegistryEntry[];
  private platform: NodeJS.Platform;

  constructor() {
    this.platform = os.platform();
    this.registry = this.getDefaultRegistry();
  }

  /** Returns the default app registry for the current OS. */
  private getDefaultRegistry(): AppRegistryEntry[] {
    if (this.platform === 'win32') {
      return [
        { name: 'Visual Studio Code', aliases: ['vscode', 'vs code', 'code'], command: 'code' },
        { name: 'Cursor', aliases: ['cursor', 'cursor editor', 'cursor ai'], command: 'cursor' },
        { name: 'Windsurf', aliases: ['windsurf', 'windsurf editor'], command: 'windsurf' },
        { name: 'Google Chrome', aliases: ['chrome', 'google chrome'], command: 'start chrome' },
        { name: 'Mozilla Firefox', aliases: ['firefox'], command: 'start firefox' },
        { name: 'Microsoft Edge', aliases: ['edge', 'microsoft edge'], command: 'start msedge' },
        { name: 'Notepad', aliases: ['notepad'], command: 'notepad' },
        { name: 'File Explorer', aliases: ['explorer', 'file explorer', 'files'], command: 'explorer' },
        { name: 'Command Prompt', aliases: ['cmd', 'command prompt'], command: 'start cmd' },
        { name: 'PowerShell', aliases: ['powershell', 'terminal'], command: 'start powershell' },
        { name: 'Windows Terminal', aliases: ['windows terminal', 'wt'], command: 'wt' },
        { name: 'Task Manager', aliases: ['task manager', 'taskmgr'], command: 'taskmgr' },
        { name: 'Calculator', aliases: ['calculator', 'calc'], command: 'calc' },
        { name: 'Spotify', aliases: ['spotify'], command: 'start spotify:' },
        { name: 'Discord', aliases: ['discord'], command: 'start discord:' },
        { name: 'Slack', aliases: ['slack'], command: 'start slack:' },
        { name: 'WhatsApp', aliases: ['whatsapp', 'whats app'], command: `start "" "${path.join(os.homedir(), 'AppData', 'Local', 'WhatsApp', 'WhatsApp.exe')}"` },
        { name: 'Telegram', aliases: ['telegram'], command: `start "" "${path.join(os.homedir(), 'AppData', 'Roaming', 'Telegram Desktop', 'Telegram.exe')}"` },
        { name: 'Microsoft Word', aliases: ['word', 'microsoft word', 'ms word'], command: 'start winword' },
        { name: 'Microsoft Excel', aliases: ['excel', 'microsoft excel', 'ms excel'], command: 'start excel' },
        { name: 'Microsoft PowerPoint', aliases: ['powerpoint', 'ppt'], command: 'start powerpnt' },
        { name: 'Paint', aliases: ['paint', 'mspaint'], command: 'mspaint' },
        { name: 'Snipping Tool', aliases: ['snipping tool', 'screenshot'], command: 'snippingtool' },
        { name: 'Git Bash', aliases: ['git bash', 'bash'], command: 'start "" "C:\\Program Files\\Git\\git-bash.exe"' },
        { name: 'Postman', aliases: ['postman'], command: 'start "" "%LOCALAPPDATA%\\Postman\\Postman.exe"' },
        { name: 'Figma', aliases: ['figma'], command: 'start "" "%LOCALAPPDATA%\\Figma\\Figma.exe"' },
        { name: 'Obsidian', aliases: ['obsidian'], command: 'start "" "%LOCALAPPDATA%\\Obsidian\\Obsidian.exe"' },
      ];
    }

    if (this.platform === 'darwin') {
      return [
        { name: 'Visual Studio Code', aliases: ['vscode', 'vs code', 'code'], command: 'open -a "Visual Studio Code"' },
        { name: 'Google Chrome', aliases: ['chrome', 'google chrome'], command: 'open -a "Google Chrome"' },
        { name: 'Safari', aliases: ['safari'], command: 'open -a Safari' },
        { name: 'Firefox', aliases: ['firefox'], command: 'open -a Firefox' },
        { name: 'Terminal', aliases: ['terminal'], command: 'open -a Terminal' },
        { name: 'Finder', aliases: ['finder', 'files'], command: 'open -a Finder' },
        { name: 'Spotify', aliases: ['spotify'], command: 'open -a Spotify' },
        { name: 'Discord', aliases: ['discord'], command: 'open -a Discord' },
        { name: 'Slack', aliases: ['slack'], command: 'open -a Slack' },
      ];
    }

    // Linux
    return [
      { name: 'Visual Studio Code', aliases: ['vscode', 'vs code', 'code'], command: 'code' },
      { name: 'Google Chrome', aliases: ['chrome', 'google chrome'], command: 'google-chrome' },
      { name: 'Firefox', aliases: ['firefox'], command: 'firefox' },
      { name: 'Terminal', aliases: ['terminal'], command: 'gnome-terminal' },
      { name: 'Files', aliases: ['files', 'nautilus'], command: 'nautilus' },
      { name: 'Spotify', aliases: ['spotify'], command: 'spotify' },
      { name: 'Discord', aliases: ['discord'], command: 'discord' },
    ];
  }

  /** Add a custom app to the registry. */
  registerApp(entry: AppRegistryEntry): void {
    this.registry.push(entry);
    logger.info(`Registered app: ${entry.name}`);
  }

  /** Find an app in the registry by name or alias. */
  findApp(query: string): AppRegistryEntry | undefined {
    const q = query.toLowerCase().trim();
    return this.registry.find(
      (app) =>
        app.name.toLowerCase() === q ||
        app.aliases.some((alias) => alias.toLowerCase() === q)
    );
  }

  /** Launch an application by name. */
  async launch(appName: string, args?: string): Promise<ExecutionResult> {
    const app = this.findApp(appName);
    if (!app) {
      // Smart fallback: try launching by name directly via the shell
      // This handles apps installed but not in the registry (e.g. custom installs)
      if (this.platform === 'win32') {
        try {
          const fallbackCmd = `start "" "${appName}"`;
          logger.info(`App not in registry, trying smart fallback: ${fallbackCmd}`);
          await execAsync(fallbackCmd, { timeout: 10_000, shell: 'cmd.exe' });
          return { success: true, message: `Launched ${appName}` };
        } catch {
          // Fallback failed too
        }
      }
      return {
        success: false,
        message: `Application "${appName}" was not found. Try opening it manually or install it first.`,
      };
    }

    try {
      const cmd = args ? `${app.command} ${args}` : app.command;
      logger.info(`Launching: ${app.name} -> ${cmd}`);
      // On Windows, 'start' is a cmd.exe built-in and won't run without a shell.
      // Specifying shell ensures built-in commands work correctly.
      await execAsync(cmd, {
        timeout: 10_000,
        shell: this.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      });
      return { success: true, message: `Successfully launched ${app.name}` };
    } catch (error: unknown) {
      // Many GUI apps detach immediately — exec may get a non-zero exit code
      // even though the app launched fine. Treat those as successes.
      const err = error as { killed?: boolean; code?: number; stderr?: string; message?: string };
      if (!err.killed && (err.code === 1 || err.code === 0 || err.code == null)) {
        logger.info(`Launched ${app.name} (detached)`);
        return { success: true, message: `Launched ${app.name}` };
      }
      logger.error(`Failed to launch ${app.name}: ${err.stderr || err.message}`);
      return { success: false, message: `Failed to launch ${app.name}: ${err.stderr || err.message}` };
    }
  }

  /** List all registered applications. */
  listApps(): string[] {
    return this.registry.map((app) => app.name);
  }

  /**
   * Open a folder or file in a code editor (VS Code, Cursor, Windsurf).
   * Falls back gracefully if the preferred editor isn't installed.
   */
  async openInEditor(targetPath: string, editor = 'vscode'): Promise<ExecutionResult> {
    const editorKey = editor.toLowerCase().replace(/\s/g, '');

    const editorCommands: Record<string, { cmd: string; name: string }[]> = {
      vscode:    [{ cmd: 'code', name: 'VS Code' }],
      cursor:    [{ cmd: 'cursor', name: 'Cursor' }, { cmd: 'code', name: 'VS Code' }],
      windsurf:  [{ cmd: 'windsurf', name: 'Windsurf' }, { cmd: 'code', name: 'VS Code' }],
      // aliases
      vscodium:  [{ cmd: 'codium', name: 'VSCodium' }, { cmd: 'code', name: 'VS Code' }],
    };

    const candidates = editorCommands[editorKey] || editorCommands['vscode'];
    const shell = this.platform === 'win32' ? 'cmd.exe' : '/bin/sh';

    for (const { cmd, name } of candidates) {
      try {
        logger.info(`Opening "${targetPath}" in ${name}`);
        await execAsync(`${cmd} "${targetPath}"`, { timeout: 10_000, shell });
        return { success: true, message: `Opened in ${name}: \`${targetPath}\`` };
      } catch {
        // try next candidate
      }
    }

    // Ultimate fallback: open in file explorer so the user can open it manually
    await this.launch('File Explorer', `"${targetPath}"`).catch(() => {});
    return {
      success: false,
      message: `Could not find ${candidates.map(c => c.name).join(' or ')}. Opened folder in File Explorer instead.\nMake sure your editor's CLI is in PATH (e.g. \`code\` for VS Code).`,
    };
  }
}

export default new AppLauncher();
