import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { ExecutionResult } from '../../shared/types';
import logger from '../../shared/logger';
import { config } from '../../config';

const execAsync = promisify(exec);

// Dangerous patterns that should never be executed
const BLOCKED_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s+\//i,        // rm -rf /
  /format\s+[a-z]:/i,                       // format C:
  /del\s+\/[sfq]/i,                          // del /s /f /q
  /mkfs/i,                                   // mkfs
  /dd\s+if=/i,                               // dd if=
  />\s*\/dev\/sd/i,                          // write to raw device
  /shutdown/i,                               // shutdown
  /reboot/i,                                 // reboot
  /:(){ :\|:& };:/,                          // fork bomb
  /wget.*\|\s*(ba)?sh/i,                     // piped execution from web
  /curl.*\|\s*(ba)?sh/i,                     // piped execution from web
];

// Allowed safe commands (whitelist approach for common operations)
const SAFE_COMMAND_PREFIXES = [
  'echo', 'cat', 'type', 'dir', 'ls', 'pwd', 'cd', 'mkdir',
  'git clone', 'git status', 'git log', 'git pull', 'git push',
  'git checkout', 'git branch', 'git init', 'git add', 'git commit',
  'npm init', 'npm install', 'npm run', 'npm start',
  'node', 'npx', 'tsc',
  'code', 'start', 'open',
  'pip install', 'python',
  'docker ps', 'docker images',
];

/**
 * Command Runner Module
 * Safely executes shell commands with validation and timeout.
 */
export class CommandRunner {
  /** Check if a command is blocked. */
  private isBlocked(command: string): boolean {
    return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
  }

  /** Check if a command matches the safe whitelist. */
  private isSafe(command: string): boolean {
    const trimmed = command.trim().toLowerCase();
    return SAFE_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
  }

  /** Execute a shell command with safety checks. */
  async execute(command: string, cwd?: string): Promise<ExecutionResult> {
    // Block dangerous commands
    if (this.isBlocked(command)) {
      logger.warn(`Blocked dangerous command: ${command}`);
      return { success: false, message: 'Command blocked: this command is potentially destructive and is not allowed.' };
    }

    // Warn about non-whitelisted commands
    if (!this.isSafe(command)) {
      logger.warn(`Non-whitelisted command executed: ${command}`);
    }

    try {
      logger.info(`Executing command: ${command}${cwd ? ` (in ${cwd})` : ''}`);

      const { stdout, stderr } = await execAsync(command, {
        timeout: config.security.commandTimeout,
        cwd: cwd || os.homedir(),
        maxBuffer: 1024 * 1024, // 1MB
        shell: os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh',
      });

      const output = stdout.trim() || stderr.trim();
      return {
        success: true,
        message: output || 'Command executed successfully (no output)',
        data: { stdout: stdout.trim(), stderr: stderr.trim() },
      };
    } catch (error: unknown) {
      const err = error as { message: string; stderr?: string; killed?: boolean };
      if (err.killed) {
        return { success: false, message: `Command timed out after ${config.security.commandTimeout}ms` };
      }
      logger.error(`Command failed: ${err.message}`);
      return { success: false, message: `Command failed: ${err.stderr || err.message}` };
    }
  }

  /** Execute a command and stream output (for long-running tasks). */
  executeStreaming(
    command: string,
    onData: (data: string) => void,
    cwd?: string
  ): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      if (this.isBlocked(command)) {
        resolve({ success: false, message: 'Command blocked: potentially destructive' });
        return;
      }

      const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh';
      const shellFlag = os.platform() === 'win32' ? '/c' : '-c';

      const child = spawn(shell, [shellFlag, command], {
        cwd: cwd || os.homedir(),
        timeout: config.security.commandTimeout,
      });

      let output = '';

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        onData(text);
      });

      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        onData(text);
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          message: output.trim() || (code === 0 ? 'Done' : `Exited with code ${code}`),
        });
      });

      child.on('error', (err) => {
        resolve({ success: false, message: `Command error: ${err.message}` });
      });
    });
  }
}

export default new CommandRunner();
