import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { UserMemory, MemoryFact } from '../../shared/types';
import logger from '../../shared/logger';

const MEMORY_DIR = path.join(os.homedir(), '.clawd');
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.json');

const EMPTY_MEMORY: UserMemory = {
  facts: {},
  userProfile: {},
  lastUpdated: new Date().toISOString(),
};

/**
 * Memory Service
 * Persists user facts, preferences, and profile across sessions.
 * Stored in ~/.clawd/memory.json
 */
export class MemoryService {
  private cache: UserMemory | null = null;

  // ─── Load / Save ──────────────────────────────────────────────────────────

  private async load(): Promise<UserMemory> {
    if (this.cache) return this.cache;
    try {
      await fs.mkdir(MEMORY_DIR, { recursive: true });
      const raw = await fs.readFile(MEMORY_FILE, 'utf-8');
      this.cache = JSON.parse(raw) as UserMemory;
      return this.cache;
    } catch {
      this.cache = { ...EMPTY_MEMORY, facts: {}, userProfile: {} };
      return this.cache;
    }
  }

  private async save(memory: UserMemory): Promise<void> {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    memory.lastUpdated = new Date().toISOString();
    await fs.writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf-8');
    this.cache = memory;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Store a named fact. Key is lowercased for case-insensitive lookup. */
  async remember(key: string, value: string): Promise<void> {
    const memory = await this.load();
    const normalizedKey = key.toLowerCase().trim();
    memory.facts[normalizedKey] = {
      key: normalizedKey,
      value,
      createdAt: new Date().toISOString(),
    };
    // Mirror well-known profile keys
    const profileKeys = ['name', 'email', 'language', 'city', 'country', 'job', 'project', 'github'];
    if (profileKeys.includes(normalizedKey)) {
      memory.userProfile[normalizedKey] = value;
    }
    await this.save(memory);
    logger.info(`Memory: stored "${normalizedKey}" = "${value}"`);
  }

  /** Retrieve a stored fact by key. Returns null if not found. */
  async recall(key: string): Promise<string | null> {
    const memory = await this.load();
    const normalizedKey = key.toLowerCase().trim();
    return memory.facts[normalizedKey]?.value ?? null;
  }

  /** Get all stored facts as a formatted string for AI context injection. */
  async getContextString(): Promise<string> {
    const memory = await this.load();
    const entries = Object.values(memory.facts);
    if (entries.length === 0) return '';
    return entries.map((f: MemoryFact) => `- ${f.key}: ${f.value}`).join('\n');
  }

  /** Get all facts as a readable Telegram-friendly message. */
  async getAllFormatted(): Promise<string> {
    const memory = await this.load();
    const entries = Object.values(memory.facts);
    if (entries.length === 0) return 'No remembered facts yet.';
    return entries.map((f: MemoryFact) => `• *${f.key}*: ${f.value}`).join('\n');
  }

  /** Delete a stored fact. */
  async forget(key: string): Promise<boolean> {
    const memory = await this.load();
    const normalizedKey = key.toLowerCase().trim();
    if (!memory.facts[normalizedKey]) return false;
    delete memory.facts[normalizedKey];
    delete memory.userProfile[normalizedKey];
    await this.save(memory);
    return true;
  }

  /** Clear ALL stored facts. */
  async clearAll(): Promise<void> {
    const fresh: UserMemory = { ...EMPTY_MEMORY, facts: {}, userProfile: {} };
    await this.save(fresh);
    logger.info('Memory: cleared all facts');
  }
}

export default new MemoryService();
