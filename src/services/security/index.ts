import path from 'path';
import os from 'os';
import { SecurityCheck } from '../../shared/types';
import logger from '../../shared/logger';
import { config } from '../../config';

// ─── Dangerous command patterns ─────────────────────────────────────────────
const DANGEROUS_COMMANDS = [
  /rm\s+(-rf?|--recursive)\s+\//i,
  /format\s+[a-z]:/i,
  /del\s+\/[sfq]/i,
  /mkfs/i,
  /dd\s+if=/i,
  />\s*\/dev\/sd/i,
  /shutdown/i,
  /reboot/i,
  /:(){ :\|:& };:/,
  /wget.*\|\s*(ba)?sh/i,
  /curl.*\|\s*(ba)?sh/i,
  /reg\s+delete/i,
  /net\s+user/i,
  /netsh/i,
];

// ─── Dangerous file paths ───────────────────────────────────────────────────
const PROTECTED_PATHS = [
  '/etc', '/boot', '/sys', '/proc',
  'C:\\Windows', 'C:\\Program Files',
  '/usr/bin', '/usr/sbin',
];

/**
 * Security Validator
 * Validates commands and file paths before execution.
 */
export class SecurityValidator {
  /** Validate a shell command. */
  validateCommand(command: string): SecurityCheck {
    // Check against dangerous patterns
    for (const pattern of DANGEROUS_COMMANDS) {
      if (pattern.test(command)) {
        logger.warn(`Blocked dangerous command: ${command}`);
        return {
          allowed: false,
          reason: `This command matches a dangerous pattern and has been blocked for safety.`,
        };
      }
    }

    // Check for pipe to shell (potential remote code execution)
    if (/\|\s*(ba)?sh/.test(command) && /(curl|wget|fetch)/.test(command)) {
      return {
        allowed: false,
        reason: 'Piping remote content to a shell is not allowed.',
      };
    }

    return { allowed: true };
  }

  /** Validate a file path for read/write operations. */
  validatePath(targetPath: string): SecurityCheck {
    const resolved = path.resolve(targetPath);

    // Block access to protected system paths
    for (const protectedPath of PROTECTED_PATHS) {
      if (resolved.toLowerCase().startsWith(protectedPath.toLowerCase())) {
        return {
          allowed: false,
          reason: `Access to system directory "${protectedPath}" is not allowed.`,
        };
      }
    }

    // If allowed paths are configured, enforce them
    const allowedPaths = config.security.allowedPaths;
    if (allowedPaths.length > 0) {
      const isAllowed = allowedPaths.some((allowed) =>
        resolved.startsWith(path.resolve(allowed))
      );

      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Path "${resolved}" is outside the allowed directories.`,
        };
      }
    }

    return { allowed: true };
  }

  /** Validate a URL. */
  validateUrl(url: string): SecurityCheck {
    try {
      const parsed = new URL(url);

      // Only allow http and https
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return {
          allowed: false,
          reason: `Only http and https URLs are allowed. Got: ${parsed.protocol}`,
        };
      }

      // Block local/internal URLs
      const hostname = parsed.hostname.toLowerCase();
      const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254'];
      if (blockedHosts.includes(hostname) || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
        // Allow localhost only for Ollama
        if (hostname === 'localhost' && parsed.port === '11434') {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: 'Access to local/internal network addresses is restricted.',
        };
      }

      return { allowed: true };
    } catch {
      return { allowed: false, reason: 'Invalid URL format.' };
    }
  }

  /** Check if an action requires user confirmation. */
  requiresConfirmation(action: string): boolean {
    if (!config.security.requireConfirmation) return false;

    const riskyActions = ['delete_file', 'run_command', 'clone_repo'];
    return riskyActions.includes(action);
  }
}

export default new SecurityValidator();
