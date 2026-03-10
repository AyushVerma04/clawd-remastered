import axios, { AxiosInstance } from 'axios';
import { config } from '../../config';
import { AICommand, OllamaGenerateRequest, OllamaGenerateResponse } from '../../shared/types';
import logger from '../../shared/logger';

// ─── Rule-based fast-path patterns (no LLM needed) ──────────────────────────

/** Well-known websites mapped by keyword. */
const KNOWN_SITES: Record<string, string> = {
  youtube: 'https://youtube.com',
  'you tube': 'https://youtube.com',
  yt: 'https://youtube.com',
  leetcode: 'https://leetcode.com',
  github: 'https://github.com',
  stackoverflow: 'https://stackoverflow.com',
  'stack overflow': 'https://stackoverflow.com',
  google: 'https://google.com',
  twitter: 'https://twitter.com',
  reddit: 'https://reddit.com',
  linkedin: 'https://linkedin.com',
  netflix: 'https://netflix.com',
  npm: 'https://npmjs.com',
  docker: 'https://hub.docker.com',
  chatgpt: 'https://chat.openai.com',
  claude: 'https://claude.ai',
  gmail: 'https://mail.google.com',
  drive: 'https://drive.google.com',
  'google drive': 'https://drive.google.com',
  twitch: 'https://twitch.tv',
  spotify: 'https://open.spotify.com',
  instagram: 'https://instagram.com',
  facebook: 'https://facebook.com',
  whatsapp: 'https://web.whatsapp.com',
  notion: 'https://notion.so',
  figma: 'https://figma.com',
};

/** Well-known app aliases. */
const KNOWN_APPS: Record<string, string> = {
  vscode: 'vscode',
  'vs code': 'vscode',
  'visual studio code': 'vscode',
  code: 'vscode',
  chrome: 'Google Chrome',
  'google chrome': 'Google Chrome',
  firefox: 'Mozilla Firefox',
  edge: 'Microsoft Edge',
  'microsoft edge': 'Microsoft Edge',
  notepad: 'Notepad',
  explorer: 'File Explorer',
  'file explorer': 'File Explorer',
  files: 'File Explorer',
  cmd: 'Command Prompt',
  'command prompt': 'Command Prompt',
  terminal: 'Windows Terminal',
  powershell: 'PowerShell',
  spotify: 'Spotify',
  discord: 'Discord',
  slack: 'Slack',
  word: 'Microsoft Word',
  'ms word': 'Microsoft Word',
  excel: 'Microsoft Excel',
  'ms excel': 'Microsoft Excel',
  powerpoint: 'Microsoft PowerPoint',
  ppt: 'Microsoft PowerPoint',
  calculator: 'Calculator',
  calc: 'Calculator',
  paint: 'Paint',
};

/** Named folder aliases. */
const KNOWN_FOLDERS: Record<string, string> = {
  downloads: 'downloads',
  download: 'downloads',
  documents: 'documents',
  document: 'documents',
  docs: 'documents',
  desktop: 'desktop',
  pictures: 'pictures',
  photos: 'pictures',
  images: 'pictures',
  music: 'music',
  videos: 'videos',
  video: 'videos',
  movies: 'videos',
};

/** Browser names. */
const BROWSER_KEYWORDS = ['chrome', 'firefox', 'edge', 'safari', 'browser'];

/** Patterns that indicate a conversational/question message (not a computer command). */
const CONVERSATIONAL_PATTERNS = [
  /^(what|who|when|where|why|how|explain|tell me|describe|define|give me|list|can you|could you|do you|are you|is there|what is|what are|what's)\b/i,
  /\?$/,                        // ends with question mark
  /^(hi|hello|hey|good\s+(morning|evening|afternoon|night))\b/i,
  /^(thanks|thank you|ok|okay|sure|got it|understood|makes sense)\b/i,
];

/** Messages that look conversational but are actually about a recently created file. */
const FILE_CONTEXT_PATTERNS = [
  /where\s+(is|did|was)\s+(this|the|that|my|it)/i,
  /what\s+(is|was)\s+the\s+(path|location|file|name)/i,
  /where\s+(did\s+you\s+)?(save|put|create|write|store)/i,
  /show\s+me\s+(the\s+)?(file|path|location)/i,
];

/**
 * Try to resolve a command purely with rules, without calling the LLM.
 * Returns null if no rule matches and LLM is needed.
 * Pass `context` to handle follow-up questions about previous actions.
 */
function tryRuleBased(message: string, context?: SessionContext): AICommand | null {
  const msg = message.toLowerCase().trim();

  // ─── File context follow-up questions ("where is this file?") ────────────
  if (context?.lastCreatedFile && FILE_CONTEXT_PATTERNS.some((p) => p.test(msg))) {
    return {
      action: 'chat',
      params: {
        reply: `The file was saved here:\n\`${context.lastCreatedFile}\``,
      },
    };
  }

  // ─── Conversational / question detection → route to AI chat ──────────────
  // Only treat as conversational if it clearly doesn't start with an action verb
  const isActionVerb = /^(open|launch|start|go to|visit|search|find|create|make|write|delete|remove|clone|run|execute|show|navigate)/i.test(msg);
  if (!isActionVerb && CONVERSATIONAL_PATTERNS.some((p) => p.test(msg))) {
    return { action: 'chat', params: { question: message } };
  }

  // ─── "Open <X> in file explorer / windows explorer" ────────────────────
  const inExplorerMatch = msg.match(
    /^(?:open|show|navigate to)\s+(?:my\s+)?(.+?)\s+in\s+(?:file\s*explorer|windows\s*explorer|explorer)$/i
  );
  if (inExplorerMatch) {
    const key = inExplorerMatch[1].trim().toLowerCase().replace(/\s*(folder|directory)$/i, '').trim();
    const folder = KNOWN_FOLDERS[key];
    if (folder) return { action: 'open_folder', params: { path: folder } };
    // Try as a literal path
    return { action: 'open_folder', params: { path: inExplorerMatch[1].trim() } };
  }

  // ─── "Open <website>" / "Open <website> in <browser>" ────────────────────
  const openInBrowserMatch = msg.match(
    /^(?:open|launch|go to|visit|browse to?)\s+(.+?)\s+in\s+(chrome|firefox|edge|safari)$/i
  );
  if (openInBrowserMatch) {
    const siteName = openInBrowserMatch[1].trim().toLowerCase();
    const browser = openInBrowserMatch[2].toLowerCase();
    const url = KNOWN_SITES[siteName] || resolveAsUrl(siteName);
    if (url) return { action: 'open_browser', params: { url, browser } };
  }

  // ─── "Search <query>" / "Search <query> in <browser>" ─────────────────────
  const searchMatch = msg.match(
    /^(?:search|google|look up|find)\s+(?:for\s+)?(.+?)(?:\s+(?:in|on|using)\s+(chrome|firefox|edge))?$/i
  );
  if (searchMatch) {
    const query = searchMatch[1].trim();
    const browser = searchMatch[2]?.toLowerCase() || '';
    const siteUrl = KNOWN_SITES[query.toLowerCase()];
    if (siteUrl) return { action: 'open_browser', params: { url: siteUrl, browser } };
    return { action: 'search_web', params: { query, browser } };
  }

  // ─── "Open <folder name> folder" ─────────────────────────────────────────
  const folderMatch = msg.match(/^(?:open|show|navigate to)\s+(?:my\s+)?(.+?)\s+folder$/i);
  if (folderMatch) {
    const key = folderMatch[1].trim().toLowerCase();
    const folder = KNOWN_FOLDERS[key];
    if (folder) return { action: 'open_folder', params: { path: folder } };
  }

  // ─── "Open <website/app/folder>" – plain ────────────────────────────────
  const openMatch = msg.match(
    /^(?:open|launch|start|go to|visit|browse to?)\s+(.+)$/i
  );
  if (openMatch) {
    const rawTarget = openMatch[1].trim();
    const target = rawTarget.toLowerCase();

    // Strip " app" suffix for app lookup
    const appKey = target.replace(/\s+app$/i, '').trim();

    // Known website?
    if (KNOWN_SITES[target]) {
      return { action: 'open_browser', params: { url: KNOWN_SITES[target], browser: '' } };
    }

    // Known app? (with or without "app" suffix)
    if (KNOWN_APPS[appKey] || KNOWN_APPS[target]) {
      return { action: 'open_app', params: { app: KNOWN_APPS[appKey] || KNOWN_APPS[target] } };
    }

    // Known folder?
    const folderKey = target.replace(/\s*(folder|directory|in file explorer|in explorer)$/i, '').trim();
    if (KNOWN_FOLDERS[folderKey] || KNOWN_FOLDERS[target]) {
      return { action: 'open_folder', params: { path: KNOWN_FOLDERS[folderKey] || KNOWN_FOLDERS[target] } };
    }

    // Looks like a URL?
    const asUrl = resolveAsUrl(rawTarget);
    if (asUrl) return { action: 'open_browser', params: { url: asUrl, browser: '' } };
  }

  return null; // No rule matched — fall through to LLM
}

/** Session context passed between calls to enable follow-up questions. */
export interface SessionContext {
  lastCreatedFile?: string;
  lastAction?: string;
  lastFolder?: string;
}

/** Try to resolve a string as a valid URL or domain. */
function resolveAsUrl(input: string): string | null {
  // Already a URL
  if (input.startsWith('http://') || input.startsWith('https://')) {
    try { new URL(input); return input; } catch { return null; }
  }
  // Looks like a domain (contains a dot, no spaces)
  if (!input.includes(' ') && input.includes('.')) {
    try { new URL(`https://${input}`); return `https://${input}`; } catch { return null; }
  }
  return null;
}

/** Extract the first valid JSON object from a string (handles LLM prose wrapping). */
function extractJson(raw: string): string {
  const trimmed = raw.trim();

  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();

  // Find first { ... } block
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

/**
 * AI Engine Service
 * Integrates with the local Ollama API (Llama 3.1) to parse user intent
 * and convert natural language into structured JSON commands.
 */
export class AIEngine {
  private client: AxiosInstance;
  private model: string;

  constructor() {
    this.model = config.ollama.model;
    this.client = axios.create({
      baseURL: config.ollama.host,
      timeout: 120_000, // 2 minutes – LLM generation can be slow
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** The system prompt that instructs the LLM to output structured JSON. */
  private getSystemPrompt(): string {
    return `You are Clawd, a helpful local AI assistant that can both control a user's computer AND answer questions like a normal AI assistant.

When the user gives a COMPUTER TASK, respond with valid JSON only. No extra text, no markdown, no code fences.
When the user asks a QUESTION or wants to CHAT, use the "chat" action.

Available action types:
- "open_app"        → params: { "app": "<app name>" }
- "open_file"       → params: { "path": "<file path>" }
- "open_folder"     → params: { "path": "<folder path>" }
- "open_browser"    → params: { "url": "<url>", "browser": "<browser name or empty>" }
- "search_web"      → params: { "query": "<search query>", "browser": "<browser or empty>" }
- "run_command"     → params: { "command": "<shell command>", "cwd": "<optional working dir>" }
- "create_file"     → params: { "path": "<file path>", "content": "<file content>" }
- "write_file"      → params: { "path": "<file path>", "content": "<file content>" }
- "read_file"       → params: { "path": "<file path>" }
- "delete_file"     → params: { "path": "<file path>" }
- "clone_repo"      → params: { "url": "<repo url>", "destination": "<optional path>" }
- "generate_content"→ params: { "topic": "<topic>", "format": "<txt|doc|md>", "lines": <number> }
- "multi_step"      → params: { "steps": [ { "action": "...", "params": {...} }, ... ] }
- "chat"            → params: { "question": "<the user question to answer conversationally>" }

Rules:
1. Use "chat" for greetings, questions, explanations, and anything that is NOT a computer task.
2. For computer tasks, always pick the most specific action type.
3. For multi-step tasks, use "multi_step" with an ordered array of steps.
4. Resolve well-known website names to URLs (e.g., "LeetCode" → "https://leetcode.com").
5. Resolve common folder names (e.g., "downloads" → user's Downloads folder path, "desktop" → Desktop folder).
6. If a command involves creating content, use "generate_content" first then "create_file".
7. Do NOT include explanations outside the JSON. Output ONLY the JSON object.

Examples:

User: "Open VS Code"
{"action":"open_app","params":{"app":"vscode"}}

User: "Open LeetCode in Chrome"
{"action":"open_browser","params":{"url":"https://leetcode.com","browser":"chrome"}}

User: "Open desktop in file explorer"
{"action":"open_folder","params":{"path":"desktop"}}

User: "What is GitHub?"
{"action":"chat","params":{"question":"What is GitHub?"}}

User: "Write 10 lines about AI in a text file"
{"action":"multi_step","params":{"steps":[{"action":"generate_content","params":{"topic":"AI","format":"txt","lines":10}},{"action":"create_file","params":{"path":"ai_notes.txt","content":"{{generated}}"}}]}}

User: "Search Docker tutorial"
{"action":"search_web","params":{"query":"Docker tutorial","browser":""}}

User: "How are you?"
{"action":"chat","params":{"question":"How are you?"}}`;
  }

  /** Send a prompt to Ollama and get a raw text response. */
  private async generate(prompt: string, format?: 'json'): Promise<string> {
    const request: OllamaGenerateRequest = {
      model: this.model,
      prompt,
      stream: false,
      format,
      options: {
        temperature: 0.1, // Low temperature for deterministic structured output
        num_predict: 1024,
      },
    };

    try {
      const response = await this.client.post<OllamaGenerateResponse>(
        '/api/generate',
        request
      );
      return response.data.response;
    } catch (error: unknown) {
      const msg = (error as Error).message;
      logger.error(`Ollama API error: ${msg}`);
      throw new Error(`Failed to communicate with Ollama: ${msg}`);
    }
  }

  /** Parse a user message into a structured AICommand. */
  async parseIntent(userMessage: string, context?: SessionContext): Promise<AICommand> {
    // ── 1. Try rule-based resolution first (fast, no LLM needed) ─────────────
    const rulebased = tryRuleBased(userMessage, context);
    if (rulebased) {
      logger.info(`Rule-based match: ${JSON.stringify(rulebased)}`);
      return rulebased;
    }

    // ── 2. Fall back to LLM ──────────────────────────────────────────────────
    const fullPrompt = `${this.getSystemPrompt()}\n\nUser: "${userMessage}"\nJSON:`;

    // Try up to 2 times — sometimes Llama wraps the JSON on first attempt
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await this.generate(fullPrompt, 'json');
        logger.info(`AI raw response (attempt ${attempt}): ${raw.substring(0, 300)}`);

        const jsonStr = extractJson(raw);
        logger.info(`Extracted JSON: ${jsonStr.substring(0, 300)}`);

        const parsed = JSON.parse(jsonStr);

        if (!parsed.action || !parsed.params) {
          throw new Error('Missing action or params in AI response');
        }

        return parsed as AICommand;
      } catch (error: unknown) {
        const msg = (error as Error).message;
        logger.warn(`Attempt ${attempt} failed to parse AI response: ${msg}`);
        if (attempt === 2) {
          logger.error(`Giving up after 2 attempts for: "${userMessage}"`);
          return {
            action: 'unknown',
            params: { originalMessage: userMessage, error: msg },
          };
        }
      }
    }

    // Should never reach here
    return { action: 'unknown', params: { originalMessage: userMessage } };
  }

  /** Generate text content on a given topic. */
  async generateContent(topic: string, lines: number = 10): Promise<string> {
    const prompt = `Write exactly ${lines} lines about "${topic}". Be informative and concise. Output only the content, no headings or extra formatting.`;

    try {
      return await this.generate(prompt);
    } catch (error: unknown) {
      logger.error(`Content generation failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /** Answer a conversational question as a helpful AI assistant. */
  async chat(question: string): Promise<string> {
    const prompt = `You are Clawd, a helpful and friendly AI assistant. Answer the following question clearly and concisely.\n\nQuestion: ${question}\n\nAnswer:`;
    try {
      return await this.generate(prompt);
    } catch (error: unknown) {
      logger.error(`Chat response failed: ${(error as Error).message}`);
      return "Sorry, I couldn't generate a response right now.";
    }
  }

  /** Check if Ollama is reachable and the model is available. */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/tags');
      const models = response.data?.models || [];
      const hasModel = models.some(
        (m: { name: string }) => m.name.startsWith(this.model)
      );

      if (!hasModel) {
        logger.warn(
          `Model ${this.model} not found. Available: ${models.map((m: { name: string }) => m.name).join(', ')}`
        );
        logger.info(`Attempting to pull model ${this.model}...`);
        await this.client.post('/api/pull', { name: this.model });
      }

      return true;
    } catch (error: unknown) {
      logger.error(`Ollama health check failed: ${(error as Error).message}`);
      return false;
    }
  }
}

export default new AIEngine();
