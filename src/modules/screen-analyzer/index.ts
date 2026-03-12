import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { ExecutionResult } from '../../shared/types';
import logger from '../../shared/logger';

const execAsync = promisify(exec);

/**
 * Screen Analyzer Module
 * Captures the desktop screenshot and sends it to Groq Vision for analysis.
 * On Windows: uses PowerShell + System.Drawing.
 * On macOS: uses screencapture.
 * On Linux: uses scrot or gnome-screenshot.
 */
export class ScreenAnalyzer {
  private tmpDir = path.join(os.tmpdir(), 'clawd-screenshots');

  /** Take a screenshot and return the image as a base64 PNG. */
  async captureScreen(): Promise<string> {
    await fs.mkdir(this.tmpDir, { recursive: true });
    const outFile = path.join(this.tmpDir, `screen_${Date.now()}.png`);

    try {
      await this.runCapture(outFile);
      const buffer = await fs.readFile(outFile);
      // Clean up temp file
      fs.unlink(outFile).catch(() => {});
      return buffer.toString('base64');
    } catch (err) {
      throw new Error(`Screenshot failed: ${(err as Error).message}`);
    }
  }

  private async runCapture(outFile: string): Promise<void> {
    const platform = os.platform();

    if (platform === 'win32') {
      // PowerShell screenshot via System.Drawing (built-in, no extra deps)
      const escaped = outFile.replace(/\\/g, '\\\\');
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
        '$screen = [System.Windows.Forms.Screen]::PrimaryScreen;',
        '$bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width,$screen.Bounds.Height);',
        '$g = [System.Drawing.Graphics]::FromImage($bmp);',
        '$g.CopyFromScreen($screen.Bounds.Location,[System.Drawing.Point]::Empty,$screen.Bounds.Size);',
        `$bmp.Save('${escaped}');`,
        '$g.Dispose(); $bmp.Dispose();',
      ].join(' ');
      await execAsync(`powershell -Command "${script}"`, { timeout: 15000 });
    } else if (platform === 'darwin') {
      await execAsync(`screencapture -x "${outFile}"`, { timeout: 10000 });
    } else {
      // Linux: try scrot, then gnome-screenshot, then import (ImageMagick)
      const cmds = [
        `scrot "${outFile}"`,
        `gnome-screenshot -f "${outFile}"`,
        `import -window root "${outFile}"`,
      ];
      let captured = false;
      for (const cmd of cmds) {
        try {
          await execAsync(cmd, { timeout: 10000 });
          captured = true;
          break;
        } catch {
          // try next
        }
      }
      if (!captured) throw new Error('No screenshot tool available (try: sudo apt install scrot)');
    }

    // Verify file was created
    if (!fsSync.existsSync(outFile)) {
      throw new Error('Screenshot command ran but no output file was created');
    }
  }

  /**
   * Capture the screen and analyze it using the provided analyzer function.
   * The analyzeFn is injected by SystemController to avoid circular imports.
   */
  async captureAndAnalyze(
    question: string,
    analyzeFn: (base64: string, q: string) => Promise<string>
  ): Promise<ExecutionResult> {
    try {
      logger.info('Capturing screen for analysis...');
      const base64 = await this.captureScreen();
      logger.info('Screenshot captured, sending to AI for analysis...');
      const analysis = await analyzeFn(base64, question);
      return { success: true, message: `🔍 *Screen Analysis:*\n\n${analysis}` };
    } catch (err) {
      const msg = (err as Error).message;
      logger.error(`Screen analysis failed: ${msg}`);
      return { success: false, message: `Screen analysis failed: ${msg}` };
    }
  }

  /**
   * Analyze an image buffer (from Telegram photo) using the provided analyzer function.
   */
  async analyzeImageBuffer(
    buffer: Buffer,
    question: string,
    analyzeFn: (base64: string, q: string, mime: string) => Promise<string>,
    mimeType = 'image/jpeg'
  ): Promise<ExecutionResult> {
    try {
      const base64 = buffer.toString('base64');
      const analysis = await analyzeFn(base64, question, mimeType);
      return { success: true, message: `🔍 *Image Analysis:*\n\n${analysis}` };
    } catch (err) {
      const msg = (err as Error).message;
      return { success: false, message: `Image analysis failed: ${msg}` };
    }
  }
}

export default new ScreenAnalyzer();
