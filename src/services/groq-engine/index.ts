import Groq from 'groq-sdk';
import os from 'os';
import { config } from '../../config';
import { AICommand } from '../../shared/types';
import logger from '../../shared/logger';

/**
 * Groq AI Engine — Task Planner & Orchestrator
 * Groq does NOT generate or modify code. Its job is to:
 *   1. Understand what the user wants to achieve
 *   2. Break it into steps using real tools (clone repo, run command, open editor)
 *   3. Return a structured JSON plan
 * Actual building is done by VS Code / Cursor / Windsurf / npm scaffolding tools.
 */
export class GroqEngine {
  private client: Groq | null = null;

  constructor() {
    if (config.groq.apiKey) {
      this.client = new Groq({ apiKey: config.groq.apiKey });
    }
  }

  get isAvailable(): boolean {
    return !!this.client && !!config.groq.apiKey;
  }

  // ─── System prompt for intent parsing (pure planner — no code generation) ──

  private getIntentSystemPrompt(memoryContext: string): string {
    const home = os.homedir().replace(/\\/g, '\\\\');
    const desktop = `${home}\\\\Desktop`;

    return `You are Clawd, a JARVIS-like AI assistant that controls a Windows computer.
You are a TASK PLANNER — you figure out the steps needed to achieve the user's goal.
You do NOT write or generate code yourself. Real coding is done by VS Code, Cursor, or npm scaffolding tools.

${memoryContext ? `USER MEMORY:\n${memoryContext}\n` : ''}
Respond with a single valid JSON object only. No prose, no markdown, no code fences.

AVAILABLE ACTIONS:
- "open_app"         → { "app": "<name>" }
- "open_file"        → { "path": "<absolute path>" }
- "open_folder"      → { "path": "<absolute path or named: desktop/downloads/documents>" }
- "open_browser"     → { "url": "<url>", "browser": "<chrome|firefox|edge|>" }
- "search_web"       → { "query": "<query>", "browser": "<browser or empty>" }
- "run_command"      → { "command": "<shell cmd>", "cwd": "<absolute Windows path or omit>" }
- "create_file"      → { "path": "<absolute path>", "content": "<content>" }
- "read_file"        → { "path": "<absolute path>" }
- "delete_file"      → { "path": "<absolute path>" }
- "search_and_clone" → { "query": "<GitHub search terms>", "destination": "<folder name>", "language": "<js|python|etc — or omit>" }
- "open_in_editor"   → { "path": "<absolute path to open>", "editor": "<vscode|cursor|windsurf>" }
- "clone_repo"       → { "url": "<VERIFIED real GitHub URL — ONLY if user explicitly provides the URL>", "destination": "<folder name or omit>" }
- "git_deploy"       → { "path": "<local project path>", "repo_name": "<repo name>", "is_private": false }
- "system_health"    → {}
- "send_email"       → { "to": "<email>", "subject": "<subject>", "body": "<body>" }
- "analyze_screen"   → { "question": "<what to look for, or 'general errors'>" }
- "notion_create"    → { "title": "<page title>", "content": "<markdown content>" }
- "notion_search"    → { "query": "<search query>" }
- "notion_append"    → { "page_id": "<page id>", "content": "<markdown to append>" }
- "remember_fact"    → { "key": "<fact key>", "value": "<fact value>" }
- "recall_fact"      → { "key": "<key, or 'all' for all facts>" }
- "generate_content" → { "topic": "<topic>", "format": "<txt|md>", "lines": <number> }
- "multi_step"       → { "steps": [ { "action": "...", "params": {...} }, ... ] }
- "chat"             → { "question": "<user question>" }

CRITICAL RULES:
1. NEVER invent or guess GitHub URLs. NEVER fabricate repo URLs.
2. When user wants to CREATE a game/app/project → use "search_and_clone" to find a real existing repo, then "open_in_editor" so the AI editor can work on it.
3. For new apps with standard scaffolding → use "run_command" with npx/npm init/create-next-app etc., then "open_in_editor".
4. "open_in_editor" should always follow clone/scaffold steps so the user can start coding.
5. cwd in run_command must be a real absolute Windows path or omitted entirely.
6. Resolve named folders: "desktop" → "${desktop}", "downloads" → "${home}\\\\Downloads".
7. For simple questions/chat → use "chat" action.

DECISION GUIDE:
- "create a [game/app]" (no specific repo) → search_and_clone + open_in_editor
- "create a React app" / "new React project" → run_command: npx create-react-app + open_in_editor
- "create a Next.js app" → run_command: npx create-next-app@latest + open_in_editor
- "create a Vite app" → run_command: npm create vite@latest + open_in_editor
- "clone [URL user gave]" → clone_repo with that exact URL
- "pull and run a repo" → search_and_clone + run_command: npm install + run_command: npm start

EXAMPLES:

User: "Create a tic tac toe game"
{"action":"multi_step","params":{"steps":[{"action":"search_and_clone","params":{"query":"tic tac toe javascript game","destination":"tic-tac-toe","language":"javascript"}},{"action":"open_in_editor","params":{"path":"${desktop}\\\\tic-tac-toe","editor":"cursor"}}]}}

User: "Create a new React app called my-dashboard"
{"action":"multi_step","params":{"steps":[{"action":"run_command","params":{"command":"npx create-react-app my-dashboard","cwd":"${desktop}"}},{"action":"open_in_editor","params":{"path":"${desktop}\\\\my-dashboard","editor":"cursor"}}]}}

User: "Pull a snake game and run it"
{"action":"multi_step","params":{"steps":[{"action":"search_and_clone","params":{"query":"snake game javascript html","destination":"snake-game"}},{"action":"run_command","params":{"command":"npm install","cwd":"${desktop}\\\\snake-game"}},{"action":"open_in_editor","params":{"path":"${desktop}\\\\snake-game","editor":"vscode"}}]}}

User: "Create a Node.js API then push to GitHub"
{"action":"multi_step","params":{"steps":[{"action":"run_command","params":{"command":"mkdir my-api && cd my-api && npm init -y && npm install express","cwd":"${desktop}"}},{"action":"open_in_editor","params":{"path":"${desktop}\\\\my-api","editor":"cursor"}},{"action":"git_deploy","params":{"path":"${desktop}\\\\my-api","repo_name":"my-api","is_private":false}}]}}

User: "What is my name?"
{"action":"recall_fact","params":{"key":"name"}}

User: "Remember that my name is Alex"
{"action":"remember_fact","params":{"key":"name","value":"Alex"}}

User: "Send an email to boss@company.com about project update"
{"action":"send_email","params":{"to":"boss@company.com","subject":"Project Update","body":"Hi, here is the latest project update."}}

User: "Check system health"
{"action":"system_health","params":{}}

User: "What's the error on my screen?"
{"action":"analyze_screen","params":{"question":"Identify any errors, warnings, or problems visible on screen"}}`;
  }

  // ─── Intent parsing (for complex tasks) ───────────────────────────────────

  async parseIntent(message: string, memoryContext = ''): Promise<AICommand> {
    if (!this.client) throw new Error('Groq API key not configured');

    const systemPrompt = this.getIntentSystemPrompt(memoryContext);

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const completion = await this.client.chat.completions.create({
          model: config.groq.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          temperature: 0.1,
          max_tokens: 1024,
          response_format: { type: 'json_object' },
        });

        const raw = completion.choices[0]?.message?.content || '{}';
        logger.info(`Groq intent (attempt ${attempt}): ${raw.substring(0, 200)}`);

        const parsed = JSON.parse(raw);
        if (!parsed.action || !parsed.params) throw new Error('Missing action or params');
        return parsed as AICommand;
      } catch (err) {
        logger.warn(`Groq intent attempt ${attempt} failed: ${(err as Error).message}`);
        if (attempt === 2) {
          return { action: 'chat', params: { question: message } };
        }
      }
    }

    return { action: 'unknown', params: { originalMessage: message } };
  }

  // ─── Chat (conversational AI) ──────────────────────────────────────────────

  async chat(question: string, memoryContext = ''): Promise<string> {
    if (!this.client) throw new Error('Groq API key not configured');

    const systemContent = `You are Clawd, a helpful JARVIS-like AI assistant. Be concise and helpful.${memoryContext ? `\n\nUser context:\n${memoryContext}` : ''}`;

    const completion = await this.client.chat.completions.create({
      model: config.groq.model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: question },
      ],
      temperature: 0.7,
      max_tokens: 2048,
    });

    return completion.choices[0]?.message?.content?.trim() || 'No response.';
  }

  // ─── Vision / screen analysis ──────────────────────────────────────────────

  async analyzeImage(base64Image: string, question: string, mimeType = 'image/png'): Promise<string> {
    if (!this.client) throw new Error('Groq API key not configured');

    const completion = await this.client.chat.completions.create({
      model: config.groq.visionModel,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are a senior developer analyzing a screenshot. ${question}\n\nProvide a clear, concise analysis. Focus on errors, warnings, and actionable fixes if applicable.`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ],
        },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });

    return completion.choices[0]?.message?.content?.trim() || 'Unable to analyze the image.';
  }

  // ─── Health check ──────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.chat.completions.create({
        model: config.groq.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      });
      return true;
    } catch {
      return false;
    }
  }
}

export default new GroqEngine();
