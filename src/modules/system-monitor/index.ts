import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ExecutionResult } from '../../shared/types';
import logger from '../../shared/logger';
import { config } from '../../config';

const execAsync = promisify(exec);

/**
 * System Monitor Module
 * Reports CPU, RAM, disk, uptime, and top processes.
 * Uses the `systeminformation` package for cross-platform data.
 */
export class SystemMonitor {
  async getHealth(): Promise<ExecutionResult> {
    try {
      // Dynamic import so the app still starts if the package isn't installed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const si = require('systeminformation');

      const [cpuLoad, mem, disks, time] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.time(),
      ]);

      const cpuPct = (cpuLoad.currentLoad as number).toFixed(1);
      const ramUsed = this.bytesToGB(mem.used);
      const ramTotal = this.bytesToGB(mem.total);
      const ramPct = ((mem.used / mem.total) * 100).toFixed(1);

      const diskLines = (disks as Array<{ fs: string; size: number; used: number; use: number }>)
        .filter((d) => d.size > 0)
        .slice(0, 3)
        .map((d) => `  ${d.fs}: ${this.bytesToGB(d.used)}/${this.bytesToGB(d.size)} GB (${d.use.toFixed(1)}%)`);

      const uptimeHours = Math.floor((time.uptime as number) / 3600);
      const uptimeMins = Math.floor(((time.uptime as number) % 3600) / 60);

      const report = [
        '🖥️ *System Health Report*\n',
        `🔥 *CPU:* ${cpuPct}% used`,
        `💾 *RAM:* ${ramUsed}/${ramTotal} GB (${ramPct}%)`,
        `⏱️ *Uptime:* ${uptimeHours}h ${uptimeMins}m`,
        '💿 *Disk:*',
        ...diskLines,
        `🖥️ *OS:* ${os.type()} ${os.release()}`,
        `💻 *Node:* ${process.version}`,
      ].join('\n');

      return { success: true, message: report };
    } catch (err) {
      logger.error(`System monitor error: ${(err as Error).message}`);
      // Fallback to basic Node.js built-ins
      return this.getFallbackHealth();
    }
  }

  private getFallbackHealth(): ExecutionResult {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const uptimeSecs = os.uptime();
    const uptimeHours = Math.floor(uptimeSecs / 3600);
    const uptimeMins = Math.floor((uptimeSecs % 3600) / 60);

    const report = [
      '🖥️ *System Health Report*\n',
      `💾 *RAM:* ${this.bytesToGB(usedMem)}/${this.bytesToGB(totalMem)} GB`,
      `⏱️ *Uptime:* ${uptimeHours}h ${uptimeMins}m`,
      `🖥️ *OS:* ${os.type()} ${os.release()} (${os.arch()})`,
      `💻 *Node:* ${process.version}`,
      `🔢 *CPUs:* ${os.cpus().length}x ${os.cpus()[0]?.model || 'unknown'}`,
    ].join('\n');

    return { success: true, message: report };
  }

  private bytesToGB(bytes: number): string {
    return (bytes / 1024 / 1024 / 1024).toFixed(2);
  }

  /** Get top memory-consuming processes (Windows only). */
  async getTopProcesses(): Promise<string> {
    try {
      if (os.platform() === 'win32') {
        const { stdout } = await execAsync(
          'tasklist /fo csv /nh | sort /r',
          { timeout: 10000, shell: 'cmd.exe' }
        );
        const lines = stdout.trim().split('\n').slice(0, 8);
        const processes = lines.map((line) => {
          const parts = line.split(',');
          const name = (parts[0] || '').replace(/"/g, '').substring(0, 20).padEnd(20);
          const pid = (parts[1] || '').replace(/"/g, '');
          const mem = (parts[4] || '').replace(/"/g, '').trim();
          return `${name} PID:${pid.padEnd(6)} Mem:${mem}`;
        });
        return processes.join('\n');
      }
      const { stdout } = await execAsync(
        'ps aux --sort=-%mem | head -10',
        { timeout: 10000, shell: '/bin/sh' }
      );
      return stdout.trim();
    } catch {
      return 'Unable to retrieve process list.';
    }
  }
}

export default new SystemMonitor();
