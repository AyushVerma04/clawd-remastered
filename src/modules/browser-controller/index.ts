import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { ExecutionResult } from '../../shared/types';
import logger from '../../shared/logger';

const execAsync = promisify(exec);

/**
 * Browser Controller Module
 * Opens URLs and performs web searches.
 */
export class BrowserController {
  private platform: NodeJS.Platform;

  constructor() {
    this.platform = os.platform();
  }

  /** Build a platform-specific command to open a URL in a given browser. */
  private buildOpenCommand(url: string, browser?: string): string {
    const browserLower = (browser || 'default').toLowerCase();

    if (this.platform === 'win32') {
      // On Windows, 'start' needs an empty-string first arg as the window title.
      // Without it, start treats the URL as the title and opens a blank CMD window.
      const browserMap: Record<string, string> = {
        chrome: 'start chrome',
        firefox: 'start firefox',
        edge: 'start msedge',
      };
      const cmd = browserMap[browserLower];
      if (cmd) {
        return `${cmd} "${url}"`;
      }
      // Default: open in whatever the user's default browser is
      return `start "" "${url}"`;
    }

    if (this.platform === 'darwin') {
      const browserMap: Record<string, string> = {
        chrome: 'open -a "Google Chrome"',
        firefox: 'open -a Firefox',
        safari: 'open -a Safari',
        default: 'open',
      };
      const cmd = browserMap[browserLower] || browserMap['default'];
      return `${cmd} "${url}"`;
    }

    // Linux
    const browserMap: Record<string, string> = {
      chrome: 'google-chrome',
      firefox: 'firefox',
      default: 'xdg-open',
    };
    const cmd = browserMap[browserLower] || browserMap['default'];
    return `${cmd} "${url}"`;
  }

  /** Validate that a string is a safe URL. */
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  /** Open a URL in the user's browser. */
  async openUrl(url: string, browser?: string): Promise<ExecutionResult> {
    // Add https if no protocol is specified
    let fullUrl = url;
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
      fullUrl = `https://${fullUrl}`;
    }

    if (!this.isValidUrl(fullUrl)) {
      return { success: false, message: `Invalid URL: ${url}` };
    }

    try {
      const cmd = this.buildOpenCommand(fullUrl, browser);
      logger.info(`Opening URL: ${fullUrl} (browser: ${browser || 'default'}) -> ${cmd}`);
      await execAsync(cmd, {
        timeout: 10_000,
        // 'start' is a cmd.exe built-in; must run inside cmd.exe on Windows
        shell: this.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      });
      return { success: true, message: `Opened ${fullUrl} in ${browser || 'default browser'}` };
    } catch (error: unknown) {
      const msg = (error as Error).message;
      logger.error(`Failed to open URL: ${msg}`);
      return { success: false, message: `Failed to open URL: ${msg}` };
    }
  }

  /** Perform a web search using Google. */
  async search(query: string, browser?: string): Promise<ExecutionResult> {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    return this.openUrl(searchUrl, browser);
  }

  /** Open a well-known website by name. */
  resolveWebsite(name: string): string | null {
    const sites: Record<string, string> = {
      github: 'https://github.com',
      leetcode: 'https://leetcode.com',
      stackoverflow: 'https://stackoverflow.com',
      youtube: 'https://youtube.com',
      google: 'https://google.com',
      twitter: 'https://twitter.com',
      reddit: 'https://reddit.com',
      linkedin: 'https://linkedin.com',
      npm: 'https://npmjs.com',
      docker: 'https://hub.docker.com',
      chatgpt: 'https://chat.openai.com',
      claude: 'https://claude.ai',
    };

    const lower = name.toLowerCase().trim();
    return sites[lower] || null;
  }
}

export default new BrowserController();
