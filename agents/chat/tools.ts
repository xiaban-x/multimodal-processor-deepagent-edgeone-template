/**
 * Tool definitions and executor helpers for the document processing agent.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../_shared";

const logger = createLogger("tools");

/** Tool definitions exposed to the Anthropic model */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "commands",
    description:
      "Execute shell commands in the sandbox (e.g., ffprobe, ls, cat)",
    input_schema: {
      type: "object" as const,
      properties: {
        cmd: { type: "string", description: "Shell command to execute" },
        cwd: { type: "string", description: "Working directory (optional)" },
      },
      required: ["cmd"],
    },
  },
  {
    name: "files",
    description:
      "File operations in the sandbox — read, write, list, makeDir, exists, remove",
    input_schema: {
      type: "object" as const,
      properties: {
        op: {
          type: "string",
          enum: ["read", "write", "list", "exists", "remove", "makeDir"],
          description: "File operation",
        },
        path: { type: "string", description: "File or directory path" },
        content: { type: "string", description: "Content for write operation" },
      },
      required: ["op", "path"],
    },
  },
  {
    name: "code_interpreter",
    description:
      "Run code in an isolated interpreter. Supports python, javascript, bash.",
    input_schema: {
      type: "object" as const,
      properties: {
        language: {
          type: "string",
          enum: ["python", "javascript", "bash"],
          description: "Language to execute",
        },
        code: { type: "string", description: "Code to execute" },
      },
      required: ["language", "code"],
    },
  },
  {
    name: "deliver_file",
    description:
      "Deliver a processed file to the user for download. Call this after generating an output file (e.g., merged PDF, converted document). The file will be sent as a downloadable link.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the output file in sandbox (e.g., /tmp/merged.pdf)",
        },
        filename: {
          type: "string",
          description: "Display filename for the user (e.g., merged-report.pdf)",
        },
        description: {
          type: "string",
          description: "Brief description of the file content",
        },
      },
      required: ["path", "filename"],
    },
  },
  {
    name: "suggest_actions",
    description:
      "Present a list of recommended actions to the user as clickable options. Use this when you've analyzed files and want to suggest processing options.",
    input_schema: {
      type: "object" as const,
      properties: {
        actions: {
          type: "array",
          description: "List of suggested actions",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique action ID (e.g., action_1)" },
              emoji: { type: "string", description: "Emoji icon for the action" },
              title: { type: "string", description: "Short title (under 20 chars)" },
              description: { type: "string", description: "Brief description of what this action does (1 sentence)" },
            },
            required: ["id", "emoji", "title", "description"],
          },
        },
      },
      required: ["actions"],
    },
  },
];

/**
 * Build tool executor from context.tools
 * Uses context.tools.get(name).execute(args) — tools are atomic (files_read, files_write, etc.)
 */
export function buildToolExecutors(context: any): { execute: (name: string, args: Record<string, any>) => Promise<string>; ready: boolean } {
  if (typeof context.tools?.get !== 'function') {
    logger.error('[tools] context.tools.get not available');
    return { execute: async () => { throw new Error('No tools available'); }, ready: false };
  }

  const cmdTool = context.tools.get('commands');
  if (!cmdTool) {
    logger.error('[tools] commands tool not found');
    return { execute: async () => { throw new Error('No tools available'); }, ready: false };
  }

  const toolNames = context.tools.all?.()?.map((t: any) => t.name).join(', ') || 'unknown';
  logger.log(`[tools] ready via context.tools.get(), available: ${toolNames}`);

  return {
    ready: true,
    execute: async (name: string, args: Record<string, any>): Promise<string> => {
      const tool = context.tools.get(name);
      if (!tool || typeof tool.execute !== 'function') {
        throw new Error(`Tool "${name}" not found`);
      }
      const result = await tool.execute(args);
      if (typeof result === 'string') return result;
      if (result?.content) {
        if (Array.isArray(result.content)) {
          return result.content.map((c: any) => c.text || JSON.stringify(c)).join('');
        }
        return String(result.content);
      }
      return JSON.stringify(result, null, 2);
    },
  };
}

/** Shell-safe quoting */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Text file extensions that can be inlined when sandbox is unavailable */
const TEXT_FALLBACK_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.xml', '.html', '.css',
  '.js', '.ts', '.tsx', '.py', '.log', '.yml', '.yaml', '.sql',
]);

/** Check if a file can be safely inlined as UTF-8 text */
export function canInlineFallbackFile(fileName: string, content: Buffer): boolean {
  const lowerName = fileName.toLowerCase();
  const extension = lowerName.includes('.')
    ? lowerName.slice(lowerName.lastIndexOf('.'))
    : '';
  if (!TEXT_FALLBACK_EXTENSIONS.has(extension)) return false;
  if (content.includes(0)) return false;

  const decoded = content.toString('utf8');
  const replacementCount = decoded.match(/\uFFFD/g)?.length ?? 0;
  return replacementCount / Math.max(decoded.length, 1) < 0.01;
}
