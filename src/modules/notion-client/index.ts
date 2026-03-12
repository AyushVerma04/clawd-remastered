import { Client } from '@notionhq/client';
import { config } from '../../config';
import { ExecutionResult } from '../../shared/types';
import logger from '../../shared/logger';

/**
 * Notion Client Module
 * Create pages, search, and append content to a Notion workspace.
 * Requires NOTION_API_KEY and optionally NOTION_DATABASE_ID in .env.
 */
export class NotionClient {
  private client: Client | null = null;

  constructor() {
    if (config.notion.apiKey) {
      this.client = new Client({ auth: config.notion.apiKey });
    }
  }

  get isConfigured(): boolean {
    return !!this.client;
  }

  private notConfiguredError(): ExecutionResult {
    return {
      success: false,
      message:
        'Notion is not configured. Add NOTION_API_KEY to your .env file.\n' +
        'Get your integration token at: https://www.notion.so/my-integrations',
    };
  }

  // ─── Convert markdown-ish text into Notion blocks ─────────────────────────

  private markdownToBlocks(content: string): object[] {
    const lines = content.split('\n');
    const blocks: object[] = [];

    for (const line of lines) {
      if (!line.trim()) {
        blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } });
        continue;
      }

      if (line.startsWith('# ')) {
        blocks.push({
          object: 'block', type: 'heading_1',
          heading_1: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
        });
      } else if (line.startsWith('## ')) {
        blocks.push({
          object: 'block', type: 'heading_2',
          heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3) } }] },
        });
      } else if (line.startsWith('### ')) {
        blocks.push({
          object: 'block', type: 'heading_3',
          heading_3: { rich_text: [{ type: 'text', text: { content: line.slice(4) } }] },
        });
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        blocks.push({
          object: 'block', type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
        });
      } else if (/^\d+\. /.test(line)) {
        blocks.push({
          object: 'block', type: 'numbered_list_item',
          numbered_list_item: { rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\. /, '') } }] },
        });
      } else if (line.startsWith('> ')) {
        blocks.push({
          object: 'block', type: 'quote',
          quote: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
        });
      } else {
        blocks.push({
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
        });
      }
    }

    // Notion API limits 100 blocks per request
    return blocks.slice(0, 100);
  }

  // ─── Create a new page ─────────────────────────────────────────────────────

  async createPage(title: string, content: string): Promise<ExecutionResult> {
    if (!this.client) return this.notConfiguredError();

    try {
      const children = this.markdownToBlocks(content);

      let parent: object;
      if (config.notion.databaseId) {
        parent = { database_id: config.notion.databaseId };
      } else {
        // If no database specified, try to create in page context
        // This will fail without a valid parent — user must set NOTION_DATABASE_ID
        return {
          success: false,
          message:
            'Set NOTION_DATABASE_ID in .env to specify where pages are created.\n' +
            'Open your Notion database and copy the ID from the URL.',
        };
      }

      const page = await (this.client as Client).pages.create({
        parent: parent as Parameters<Client['pages']['create']>[0]['parent'],
        properties: {
          Name: { title: [{ text: { content: title } }] },
        },
        children: children as Parameters<Client['pages']['create']>[0]['children'],
      });

      const pageUrl = (page as { url?: string }).url || 'https://notion.so';
      logger.info(`Notion page created: ${pageUrl}`);
      return {
        success: true,
        message: `📝 Notion page created!\n*${title}*\n🔗 ${pageUrl}`,
        data: { url: pageUrl, id: page.id },
      };
    } catch (err) {
      const msg = (err as Error).message;
      logger.error(`Notion create failed: ${msg}`);
      return { success: false, message: `Failed to create Notion page: ${msg}` };
    }
  }

  // ─── Search pages ─────────────────────────────────────────────────────────

  async searchPages(query: string): Promise<ExecutionResult> {
    if (!this.client) return this.notConfiguredError();

    try {
      const results = await (this.client as Client).search({
        query,
        filter: { value: 'page', property: 'object' },
        page_size: 5,
      });

      if (results.results.length === 0) {
        return { success: true, message: `No Notion pages found for: "${query}"` };
      }

      const lines = results.results.map((r) => {
        const page = r as {
          url?: string;
          properties?: { title?: { title?: Array<{ plain_text?: string }> }; Name?: { title?: Array<{ plain_text?: string }> } };
        };
        const titleArr = page.properties?.title?.title || page.properties?.Name?.title || [];
        const name = titleArr[0]?.plain_text || 'Untitled';
        return `• *${name}*\n  ${page.url || ''}`;
      });

      return { success: true, message: `🔍 Notion search: "${query}"\n\n${lines.join('\n')}` };
    } catch (err) {
      return { success: false, message: `Notion search failed: ${(err as Error).message}` };
    }
  }

  // ─── Append blocks to an existing page ────────────────────────────────────

  async appendToPage(pageId: string, content: string): Promise<ExecutionResult> {
    if (!this.client) return this.notConfiguredError();

    try {
      const blocks = this.markdownToBlocks(content);
      await (this.client as Client).blocks.children.append({
        block_id: pageId,
        children: blocks as Parameters<Client['blocks']['children']['append']>[0]['children'],
      });
      return { success: true, message: `✅ Content appended to Notion page.` };
    } catch (err) {
      return { success: false, message: `Notion append failed: ${(err as Error).message}` };
    }
  }
}

export default new NotionClient();
