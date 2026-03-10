import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ExecutionResult } from '../../shared/types';
import logger from '../../shared/logger';
import { config } from '../../config';

const execAsync = promisify(exec);

/**
 * File Manager Module
 * Handles file/folder creation, reading, deletion, and opening in the OS.
 */
export class FileManager {
  /** Validate that a path is within the allowed directories. */
  private validatePath(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    const allowedPaths = config.security.allowedPaths;

    // If no restrictions are set, allow all paths under the user's home dir
    if (allowedPaths.length === 0) {
      return resolved.startsWith(os.homedir());
    }

    return allowedPaths.some((allowed) => resolved.startsWith(path.resolve(allowed)));
  }

  /** Resolve common path aliases like ~ to actual paths. */
  resolvePath(inputPath: string): string {
    let resolved = inputPath;

    // Resolve ~ to home directory
    if (resolved.startsWith('~')) {
      resolved = path.join(os.homedir(), resolved.slice(1));
    }

    // Named folder map (canonical names → absolute paths)
    const namedFolders: Record<string, string> = {
      downloads: path.join(os.homedir(), 'Downloads'),
      download: path.join(os.homedir(), 'Downloads'),
      documents: path.join(os.homedir(), 'Documents'),
      document: path.join(os.homedir(), 'Documents'),
      docs: path.join(os.homedir(), 'Documents'),
      desktop: path.join(os.homedir(), 'Desktop'),
      pictures: path.join(os.homedir(), 'Pictures'),
      photos: path.join(os.homedir(), 'Pictures'),
      images: path.join(os.homedir(), 'Pictures'),
      music: path.join(os.homedir(), 'Music'),
      videos: path.join(os.homedir(), 'Videos'),
      movies: path.join(os.homedir(), 'Videos'),
      home: os.homedir(),
    };

    // Strip leading slashes and trailing whitespace so "/desktop" → "desktop"
    const stripped = inputPath.replace(/^[\/\\]+/, '').toLowerCase().trim();

    // Also strip trailing " folder" or " directory" suffix
    const withoutSuffix = stripped.replace(/\s*(folder|directory)$/i, '').trim();

    if (namedFolders[withoutSuffix]) {
      resolved = namedFolders[withoutSuffix];
    } else if (namedFolders[stripped]) {
      resolved = namedFolders[stripped];
    }

    return path.resolve(resolved);
  }

  /** Read a file's content. */
  async readFile(filePath: string): Promise<ExecutionResult> {
    const resolved = this.resolvePath(filePath);
    if (!this.validatePath(resolved)) {
      return { success: false, message: `Access denied: path "${resolved}" is outside allowed directories` };
    }

    try {
      const content = await fs.readFile(resolved, 'utf-8');
      return { success: true, message: `File read successfully`, data: content };
    } catch (error: unknown) {
      const msg = (error as Error).message;
      logger.error(`Failed to read file ${resolved}: ${msg}`);
      return { success: false, message: `Failed to read file: ${msg}` };
    }
  }

  /** Write content to a file, creating intermediate directories as needed. */
  async writeFile(filePath: string, content: string): Promise<ExecutionResult> {
    const resolved = this.resolvePath(filePath);
    if (!this.validatePath(resolved)) {
      return { success: false, message: `Access denied: path "${resolved}" is outside allowed directories` };
    }

    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, 'utf-8');
      logger.info(`File written: ${resolved}`);
      return { success: true, message: `File written to ${resolved}` };
    } catch (error: unknown) {
      const msg = (error as Error).message;
      logger.error(`Failed to write file ${resolved}: ${msg}`);
      return { success: false, message: `Failed to write file: ${msg}` };
    }
  }

  /** Create a new directory. */
  async createDirectory(dirPath: string): Promise<ExecutionResult> {
    const resolved = this.resolvePath(dirPath);
    if (!this.validatePath(resolved)) {
      return { success: false, message: `Access denied: path "${resolved}" is outside allowed directories` };
    }

    try {
      await fs.mkdir(resolved, { recursive: true });
      logger.info(`Directory created: ${resolved}`);
      return { success: true, message: `Directory created at ${resolved}` };
    } catch (error: unknown) {
      const msg = (error as Error).message;
      return { success: false, message: `Failed to create directory: ${msg}` };
    }
  }

  /** List contents of a directory. */
  async listDirectory(dirPath: string): Promise<ExecutionResult> {
    const resolved = this.resolvePath(dirPath);
    if (!this.validatePath(resolved)) {
      return { success: false, message: `Access denied: path "${resolved}" is outside allowed directories` };
    }

    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const items = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
      }));
      return { success: true, message: `Listed ${items.length} items in ${resolved}`, data: items };
    } catch (error: unknown) {
      const msg = (error as Error).message;
      return { success: false, message: `Failed to list directory: ${msg}` };
    }
  }

  /** Delete a file. */
  async deleteFile(filePath: string): Promise<ExecutionResult> {
    const resolved = this.resolvePath(filePath);
    if (!this.validatePath(resolved)) {
      return { success: false, message: `Access denied: path "${resolved}" is outside allowed directories` };
    }

    try {
      await fs.unlink(resolved);
      logger.info(`File deleted: ${resolved}`);
      return { success: true, message: `File deleted: ${resolved}` };
    } catch (error: unknown) {
      const msg = (error as Error).message;
      return { success: false, message: `Failed to delete file: ${msg}` };
    }
  }

  /** Open a file or folder in the OS default handler. */
  async openInOS(targetPath: string): Promise<ExecutionResult> {
    const resolved = this.resolvePath(targetPath);
    if (!this.validatePath(resolved)) {
      return { success: false, message: `Access denied: path "${resolved}" is outside allowed directories` };
    }

    if (!fsSync.existsSync(resolved)) {
      return { success: false, message: `Path does not exist: ${resolved}` };
    }

    try {
      const platform = os.platform();
      let cmd: string;
      if (platform === 'win32') {
        cmd = `start "" "${resolved}"`;
      } else if (platform === 'darwin') {
        cmd = `open "${resolved}"`;
      } else {
        cmd = `xdg-open "${resolved}"`;
      }

      await execAsync(cmd, { timeout: 10_000 });
      logger.info(`Opened in OS: ${resolved}`);
      return { success: true, message: `Opened ${resolved}` };
    } catch (error: unknown) {
      const msg = (error as Error).message;
      return { success: false, message: `Failed to open path: ${msg}` };
    }
  }

  /** Check if a path exists. */
  async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(targetPath));
      return true;
    } catch {
      return false;
    }
  }
}

export default new FileManager();
