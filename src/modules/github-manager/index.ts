import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { ExecutionResult } from '../../shared/types';
import logger from '../../shared/logger';
import { config } from '../../config';

const execAsync = promisify(exec);

/**
 * GitHub Manager Module
 * Handles real git operations: clone, init, commit, push, and
 * deploying local projects to GitHub (requires GITHUB_TOKEN).
 */
export class GitHubManager {
  // ─── Validate that a GitHub URL actually exists before cloning ─────────────

  private parseGitHubUrl(url: string): { owner: string; repo: string } | null {
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/i);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  }

  private async repoExists(owner: string, repo: string): Promise<boolean> {
    try {
      const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
      if (config.github.token) {
        headers['Authorization'] = `Bearer ${config.github.token}`;
      }
      const res = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
        headers,
        timeout: 10000,
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  // ─── Clone a real repository ───────────────────────────────────────────────

  async cloneRepo(url: string, destination?: string): Promise<ExecutionResult> {
    // Security: validate URL structure
    const parsed = this.parseGitHubUrl(url);
    if (!parsed) {
      return {
        success: false,
        message: `Invalid GitHub URL: "${url}". Use the full URL like https://github.com/owner/repo`,
      };
    }

    // Verify the repo actually exists before trying to clone
    const exists = await this.repoExists(parsed.owner, parsed.repo);
    if (!exists) {
      return {
        success: false,
        message:
          `Repository "${parsed.owner}/${parsed.repo}" was not found on GitHub.\n` +
          `Check the URL and make sure the repo is public (or provide GITHUB_TOKEN for private repos).`,
      };
    }

    const destName = destination || parsed.repo;
    const cloneDir = path.isAbsolute(destName)
      ? destName
      : path.join(os.homedir(), 'Desktop', destName);

    const cloneUrl = config.github.token
      ? `https://${config.github.token}@github.com/${parsed.owner}/${parsed.repo}.git`
      : url;

    try {
      logger.info(`Cloning ${parsed.owner}/${parsed.repo} → ${cloneDir}`);
      await execAsync(`git clone "${cloneUrl}" "${cloneDir}"`, {
        timeout: 120_000,
        shell: os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh',
      });
      // Re-set remote URL to not expose token in .git/config
      if (config.github.token) {
        await execAsync(`git -C "${cloneDir}" remote set-url origin ${url}`, {
          timeout: 5000,
          shell: os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh',
        }).catch(() => {});
      }
      return {
        success: true,
        message: `✅ Cloned ${parsed.owner}/${parsed.repo} to:\n\`${cloneDir}\``,
        data: { path: cloneDir },
      };
    } catch (err) {
      return { success: false, message: `Clone failed: ${(err as Error).message}` };
    }
  }

  // ─── Create a GitHub repo via API and push local project ──────────────────

  async deployToGitHub(
    localPath: string,
    repoName: string,
    isPrivate = false
  ): Promise<ExecutionResult> {
    if (!config.github.token || !config.github.username) {
      return {
        success: false,
        message:
          'GitHub deploy requires GITHUB_TOKEN and GITHUB_USERNAME in your .env file.\n' +
          'Create a token at: https://github.com/settings/tokens',
      };
    }

    try {
      // 1. Create the repository on GitHub
      logger.info(`Creating GitHub repo: ${config.github.username}/${repoName}`);
      const res = await axios.post(
        'https://api.github.com/user/repos',
        { name: repoName, private: isPrivate, auto_init: false },
        {
          headers: {
            Authorization: `Bearer ${config.github.token}`,
            Accept: 'application/vnd.github.v3+json',
          },
          timeout: 15000,
        }
      );

      const remoteUrl = res.data.clone_url as string;
      const authedUrl = `https://${config.github.token}@github.com/${config.github.username}/${repoName}.git`;
      const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh';

      // 2. Init git in the local folder (idempotent)
      await execAsync(`git -C "${localPath}" init`, { timeout: 10000, shell });
      await execAsync(`git -C "${localPath}" add -A`, { timeout: 10000, shell });

      // Commit only if there are staged changes
      try {
        await execAsync(
          `git -C "${localPath}" commit -m "Initial commit via Clawd"`,
          { timeout: 15000, shell }
        );
      } catch {
        // Already committed or nothing to commit — continue
      }

      // 3. Set remote and push
      await execAsync(
        `git -C "${localPath}" remote remove origin`,
        { timeout: 5000, shell }
      ).catch(() => {});
      await execAsync(
        `git -C "${localPath}" remote add origin "${authedUrl}"`,
        { timeout: 5000, shell }
      );
      await execAsync(
        `git -C "${localPath}" branch -M main`,
        { timeout: 5000, shell }
      );
      await execAsync(
        `git -C "${localPath}" push -u origin main`,
        { timeout: 60000, shell }
      );

      // Reset remote to non-token URL for security
      await execAsync(
        `git -C "${localPath}" remote set-url origin ${remoteUrl}`,
        { timeout: 5000, shell }
      ).catch(() => {});

      const repoPageUrl = `https://github.com/${config.github.username}/${repoName}`;
      return {
        success: true,
        message: `🚀 Deployed to GitHub!\n🔗 ${repoPageUrl}`,
        data: { url: repoPageUrl },
      };
    } catch (err) {
      const msg = ((err as { response?: { data?: { message?: string } } }).response?.data?.message) ||
                  (err as Error).message;
      logger.error(`GitHub deploy failed: ${msg}`);
      return { success: false, message: `GitHub deploy failed: ${msg}` };
    }
  }

  // ─── Search + Clone: find the best matching real repo and clone it ───────────

  /**
   * Search GitHub for the best matching real public repo for a query,
   * then clone it to the destination folder.
   * This is what powers "create a tic tac toe game" — it finds a real repo.
   */
  async searchAndClone(
    query: string,
    destination?: string,
    preferredLanguage?: string
  ): Promise<ExecutionResult> {
    logger.info(`Searching GitHub for: "${query}"`);

    try {
      const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
      if (config.github.token) headers['Authorization'] = `Bearer ${config.github.token}`;

      // Build search query with optional language filter
      const searchQ = preferredLanguage ? `${query} language:${preferredLanguage}` : query;

      const res = await axios.get('https://api.github.com/search/repositories', {
        params: {
          q: searchQ,
          sort: 'stars',
          order: 'desc',
          per_page: 5,
        },
        headers,
        timeout: 15000,
      });

      const repos = res.data.items as Array<{
        full_name: string;
        clone_url: string;
        html_url: string;
        description: string;
        stargazers_count: number;
        default_branch: string;
      }>;

      if (!repos || repos.length === 0) {
        return {
          success: false,
          message: `No public repos found on GitHub for: "${query}"\nTry a more specific search.`,
        };
      }

      // Pick the top result (most stars)
      const best = repos[0];
      const destName = destination || best.full_name.split('/')[1];
      const cloneDir = path.isAbsolute(destName)
        ? destName
        : path.join(os.homedir(), 'Desktop', destName);

      logger.info(`Best match: ${best.full_name} (⭐${best.stargazers_count}) → ${cloneDir}`);

      const cloneUrl = config.github.token
        ? `https://${config.github.token}@github.com/${best.full_name}.git`
        : best.clone_url;

      await execAsync(`git clone "${cloneUrl}" "${cloneDir}"`, {
        timeout: 120_000,
        shell: os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh',
      });

      // Strip token from remote for security
      if (config.github.token) {
        await execAsync(
          `git -C "${cloneDir}" remote set-url origin ${best.clone_url}`,
          { timeout: 5000, shell: os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh' }
        ).catch(() => {});
      }

      return {
        success: true,
        message:
          `✅ Found & cloned: *${best.full_name}*\n` +
          `⭐ ${best.stargazers_count} stars\n` +
          `📝 ${best.description || 'No description'}\n` +
          `📁 Saved to: \`${cloneDir}\`\n` +
          `🔗 ${best.html_url}`,
        data: { path: cloneDir, repo: best.full_name, url: best.html_url },
      };
    } catch (err) {
      const msg = (err as Error).message;
      logger.error(`search_and_clone failed: ${msg}`);
      return { success: false, message: `Search and clone failed: ${msg}` };
    }
  }

  // ─── Search public GitHub repos ────────────────────────────────────────────

  async searchRepos(query: string): Promise<ExecutionResult> {
    try {
      const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
      if (config.github.token) headers['Authorization'] = `Bearer ${config.github.token}`;

      const res = await axios.get('https://api.github.com/search/repositories', {
        params: { q: query, sort: 'stars', order: 'desc', per_page: 5 },
        headers,
        timeout: 10000,
      });

      const repos = res.data.items as Array<{
        full_name: string;
        description: string;
        html_url: string;
        stargazers_count: number;
      }>;

      if (repos.length === 0) return { success: true, message: 'No repositories found.' };

      const lines = repos.map(
        (r) => `• *${r.full_name}* ⭐${r.stargazers_count}\n  ${r.description || 'No description'}\n  ${r.html_url}`
      );
      return { success: true, message: `🔍 GitHub Search: "${query}"\n\n${lines.join('\n\n')}` };
    } catch (err) {
      return { success: false, message: `GitHub search failed: ${(err as Error).message}` };
    }
  }
}

export default new GitHubManager();
