// ─── Action Types ───────────────────────────────────────────────────────────

export type ActionType =
  | 'open_app'
  | 'open_file'
  | 'open_folder'
  | 'open_browser'
  | 'search_web'
  | 'run_command'
  | 'create_file'
  | 'write_file'
  | 'read_file'
  | 'delete_file'
  | 'clone_repo'          // Clone a known, explicit GitHub URL
  | 'search_and_clone'    // Search GitHub for best matching real repo and clone it
  | 'open_in_editor'      // Open a folder/file in VS Code, Cursor, etc.
  | 'generate_content'
  | 'git_deploy'          // git init + commit + push to GitHub
  | 'system_health'       // CPU / RAM / disk / uptime report
  | 'send_email'          // SMTP email via nodemailer
  | 'analyze_screen'      // Screenshot + Groq Vision error analysis
  | 'notion_create'       // Create a Notion page
  | 'notion_search'       // Search Notion workspace
  | 'notion_append'       // Append blocks to a Notion page
  | 'remember_fact'       // Persist a user fact to memory
  | 'recall_fact'         // Retrieve facts from memory
  | 'multi_step'
  | 'chat'
  | 'unknown';

// ─── Structured Command from AI ─────────────────────────────────────────────

export interface AICommand {
  action: ActionType;
  params: Record<string, string | string[] | boolean | number>;
}

export interface TaskPlan {
  id: string;
  originalMessage: string;
  steps: TaskStep[];
  status: TaskStatus;
  createdAt: Date;
}

export interface TaskStep {
  order: number;
  command: AICommand;
  description: string;
  status: TaskStatus;
  result?: string;
  error?: string;
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// ─── Execution Result ───────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// ─── Application Registry Entry ─────────────────────────────────────────────

export interface AppRegistryEntry {
  name: string;
  aliases: string[];
  command: string;
  path?: string;
}

// ─── Security ───────────────────────────────────────────────────────────────

export interface SecurityCheck {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}

// ─── Ollama Types ───────────────────────────────────────────────────────────

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: boolean;
  format?: 'json';
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
  };
}

// ─── User Memory ─────────────────────────────────────────────────────────────

export interface MemoryFact {
  key: string;
  value: string;
  createdAt: string;
}

export interface UserMemory {
  facts: Record<string, MemoryFact>;
  userProfile: Record<string, string>;
  lastUpdated: string;
}

// ─── Ollama Types ───────────────────────────────────────────────────────────

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
}
