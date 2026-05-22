/**
 * Document Processing Agent — EdgeOne Pages Functions
 * ====================================================
 *
 * File path: agents/chat/index.ts → maps to **POST /chat**
 *
 * Uses @anthropic-ai/sdk directly with manual tool-use loop.
 * Integrates EdgeOne sandbox tools (code_interpreter, commands, files).
 */

import Anthropic from "@anthropic-ai/sdk";
import { resolveModelName } from "../_model";
import { createLogger, sseEvent, createSSEResponse } from "../_shared";

const logger = createLogger("chat");

const SYSTEM_PROMPT = `You are a professional document processing Agent running inside an EdgeOne sandbox environment.
You specialize in handling uploaded files (PDF, Word, Excel, images, videos, CSV) and performing real operations on them.

## Available Sandbox Tools

- **commands**: Execute shell commands (e.g., ffprobe for video metadata, libreoffice for conversions).
- **files**: File operations — read, write, list, makeDir, exists, remove.
  Parameters: op (required), path (required for most ops), content (for write).
- **code_interpreter**: Run code in an isolated interpreter.
  Parameters: language (e.g. "python"), code (the source code to execute).

## Sandbox Environment Constraints

- **No apt-get/package manager** — cannot install system packages
- **No LibreOffice** — use Python libraries for document conversion
- **Pre-installed Python packages** (DO NOT pip install these): pandas, openpyxl, Pillow, PyPDF2, pdfplumber, python-docx, fpdf2, tabulate, matplotlib, numpy
- **Available commands**: python3, node, ffprobe, ffmpeg, cat, ls, find, wc
- Use "pip install <pkg>" ONLY if you get an ImportError for a package NOT in the pre-installed list

## PDF Generation Rules

When generating PDF files with Chinese content, use matplotlib (NOT fpdf2):
1. matplotlib handles CJK fonts correctly via its font manager
2. Use this pattern:
   import matplotlib
   matplotlib.use('Agg')
   import matplotlib.pyplot as plt
   from matplotlib.backends.backend_pdf import PdfPages
   from matplotlib.font_manager import FontProperties

   # Find CJK font
   font = FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')

   with PdfPages('/tmp/report.pdf') as pdf:
       fig, ax = plt.subplots(figsize=(8.27, 11.69))  # A4
       ax.axis('off')
       ax.text(0.5, 0.95, 'Report Title', fontsize=16, fontproperties=font, ha='center', va='top')
       ax.text(0.05, 0.85, 'Content here...', fontsize=10, fontproperties=font, va='top', wrap=True)
       pdf.savefig(fig)
       plt.close()

3. For tables in PDF, use ax.table() from matplotlib
4. DO NOT use fpdf2 for Chinese text (TTC font support is broken, produces garbled output)
5. fpdf2 with Helvetica is OK for English-only content
6. After generating PDF, call deliver_file to send to user

## Processing Skills by File Type

### PDF Documents
- Extract text content using pdfplumber or PyPDF2
- Merge multiple PDFs into one
- Extract page count and metadata
- Convert PDF pages to images (pdf2image)

### Word Documents (.docx)
- Extract text and structure using python-docx
- Convert Word to PDF using fpdf2 (read with python-docx, render with fpdf2)
- Extract tables and images

### Excel Files (.xlsx/.xls)
- Read all sheets and convert to Markdown tables (openpyxl/pandas)
- Generate data summaries and statistics
- Create simple visualizations (matplotlib)
- Export as CSV

### Images (.png/.jpg/.gif/.webp)
- Describe image content
- Format conversion (Pillow)
- Extract EXIF metadata
- OCR text extraction (if text is present)

### Video Files (.mp4/.mov/.avi/.mkv)
- Extract metadata (duration, resolution, codec) via ffprobe
- Generate thumbnail from first frame
- Basic format information

### CSV Files
- Convert to formatted Markdown table
- Statistical analysis (pandas describe)
- Data profiling (column types, null counts, unique values)

## Important Rules

1. Use tools when needed. Do NOT simulate or fake tool outputs — actually call the tool.
2. For document processing, prefer code_interpreter with Python.
3. When processing multiple files, handle them sequentially and report progress.
4. After processing all files, provide a summary of results.
5. If a file type is not supported or processing fails, explain clearly and suggest alternatives.
6. **All uploaded files are located in the /tmp/ directory.** Always access files at /tmp/<filename>. Do NOT search for files — they are already there.
7. **CRITICAL: For text results (tables, analysis, summaries), output directly in your response as clean Markdown. For generated binary files (PDF, images, etc.), save to /tmp/ then call the deliver_file tool to send it to the user for download.**
8. Always respond in the same language as the user's message.
9. **In code_interpreter output, use clean print() without decorative separators (no "===", "---", "***" lines). Output data cleanly — the UI will format it.**
10. **PDF GENERATION: Use matplotlib + PdfPages for Chinese PDF. DO NOT use fpdf2 for Chinese text (produces garbled output). See PDF Generation Rules section for the exact pattern.**`;

// Tool definitions for Anthropic SDK
const TOOLS: Anthropic.Tool[] = [
  {
    name: "commands",
    description:
      "Execute shell commands in the sandbox (e.g., ffprobe, libreoffice, ls, cat)",
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
      "Deliver a processed file to the user for download. Call this after generating an output file (e.g., merged PDF, converted document, analysis report). The file will be sent to the user as a downloadable link.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Path to the output file in sandbox (e.g., /tmp/merged.pdf)",
        },
        filename: {
          type: "string",
          description:
            "Display filename for the user (e.g., merged-report.pdf)",
        },
        description: {
          type: "string",
          description: "Brief description of the file content",
        },
      },
      required: ["path", "filename"],
    },
  },
];

/** Helper: get tool executor from context.tools MCP server */
function buildToolExecutors(context: any): { execute: (name: string, args: Record<string, any>) => Promise<string>; ready: boolean } {
  // Try toClaudeMcpServer() first (recommended by platform docs)
  try {
    const mcpBundle = context.tools?.toClaudeMcpServer?.();
    if (mcpBundle && mcpBundle.tools && mcpBundle.tools.length > 0) {
      const toolMap = new Map<string, any>();
      for (const tool of mcpBundle.tools) {
        const name = tool.name || '';
        toolMap.set(name, tool);
      }
      logger.log(`[tools] MCP bundle ready: ${mcpBundle.name}, tools: ${Array.from(toolMap.keys()).join(', ')}`);

      return {
        ready: true,
        execute: async (name: string, args: Record<string, any>): Promise<string> => {
          const tool = toolMap.get(name);
          if (!tool) throw new Error(`Tool "${name}" not found in MCP bundle`);
          const handler = tool.execute || tool.handler || tool.invoke;
          if (typeof handler !== 'function') throw new Error(`Tool "${name}" has no executor`);
          const result = await handler(args);
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
  } catch (e) {
    logger.log(`[tools] toClaudeMcpServer() failed: ${(e as Error).message}`);
  }

  // Fallback: use context.tools.get() directly
  if (typeof context.tools?.get === 'function') {
    logger.log('[tools] using context.tools.get() fallback');
    return {
      ready: true,
      execute: async (name: string, args: Record<string, any>): Promise<string> => {
        const tool = context.tools.get(name);
        if (!tool || typeof tool.execute !== 'function') {
          throw new Error(`Tool "${name}" not available via context.tools.get()`);
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

  // Last resort: try context.tools.all()
  const allTools = context.tools?.all?.() ?? [];
  if (allTools.length > 0) {
    logger.log(`[tools] using context.tools.all() fallback, found ${allTools.length} tools`);
    const toolMap = new Map<string, any>();
    for (const item of allTools) {
      const name = item.name || item.function?.name;
      if (name) toolMap.set(name, item);
    }
    return {
      ready: true,
      execute: async (name: string, args: Record<string, any>): Promise<string> => {
        const tool = toolMap.get(name);
        if (!tool) throw new Error(`Tool "${name}" not found`);
        const exec = tool.execute || tool.handler || tool.invoke;
        if (typeof exec !== 'function') throw new Error(`Tool "${name}" has no executor`);
        const result = await exec.call(tool, args);
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

  logger.error('[tools] no tool executors available');
  return { execute: async () => { throw new Error('No tools available'); }, ready: false };
}

export async function onRequest(context: any) {
  const body = context.request.body ?? {};
  let message = typeof body.message === "string" ? body.message.trim() : "";
  const uploadedFiles: Array<{ name: string; base64: string }> =
    body.files ?? [];

  if (!message) {
    return new Response(JSON.stringify({ error: "'message' is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const signal: AbortSignal | undefined = context.request.signal;
  // Use conversationId from request body (client-side), fallback to platform's
  const conversationId: string =
    body.conversationId || context.conversation_id || "";
  const store = context.store ?? null;

  logger.log(
    `[request] cid=${conversationId}, message="${message.slice(
      0,
      80
    )}...", files=${uploadedFiles.length}`
  );
  logger.log(`[tools] available: ${!!context.tools?.get}`);

  // Save user message to store
  if (store && conversationId) {
    try {
      await store.appendMessage({
        conversationId,
        role: "user",
        content: message,
      });
    } catch (e) {
      logger.error("[store] failed to save user message:", e);
    }
  }

  // Load conversation history from store
  let historyMessages: Anthropic.MessageParam[] = [];
  if (store && conversationId) {
    try {
      const history = await store.getMessages({ conversationId });
      if (Array.isArray(history) && history.length > 0) {
        // Convert stored messages to Anthropic format (exclude the current message we just added)
        // Only keep last 6 messages to control token usage
        const pastMessages = history.slice(0, -1).slice(-6);
        for (const msg of pastMessages) {
          if (msg.role === "user" || msg.role === "assistant") {
            // Truncate long messages to save tokens
            const content = (msg.content || "").slice(0, 2000);
            historyMessages.push({ role: msg.role, content });
          }
        }
        logger.log(
          `[history] loaded ${historyMessages.length} previous messages`
        );
      }
    } catch (e) {
      logger.error("[history] failed to load conversation history:", e);
    }
  }

  // Build tool executors from context.tools MCP bundle
  const toolBundle = buildToolExecutors(context);

  // Write uploaded files to sandbox before starting the Agent
  let sandboxWorking = false;
  if (uploadedFiles.length > 0 && toolBundle.ready) {
    // Test sandbox readiness
    try {
      const testResult = await toolBundle.execute('files', { op: 'list', path: '/tmp' });
      if (testResult && testResult.length > 10) {
        sandboxWorking = true;
        logger.log('[sandbox] ready');
      }
    } catch (e) {
      // Retry with delay
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const retryResult = await toolBundle.execute('files', { op: 'list', path: '/tmp' });
          if (retryResult && retryResult.length > 10) {
            sandboxWorking = true;
            logger.log(`[sandbox] ready (after ${attempt + 1} retries)`);
            break;
          }
        } catch {
          logger.log(`[sandbox] not ready, retrying... (attempt ${attempt + 1})`);
        }
      }
    }

    if (sandboxWorking) {
      for (const file of uploadedFiles) {
        try {
          const decoded = Buffer.from(file.base64, 'base64').toString('utf-8');
          await toolBundle.execute('files', { op: 'write', path: `/tmp/${file.name}`, content: decoded });
          logger.log(`[upload] wrote file to sandbox: /tmp/${file.name}`);
        } catch (e) {
          logger.error(`[upload] failed to write /tmp/${file.name}:`, (e as Error).message);
          sandboxWorking = false;
          break;
        }
      }
    }

    // Pre-install Python packages
    if (sandboxWorking) {
      try {
        await toolBundle.execute('commands', { cmd: 'pip install -q tabulate fpdf2 openpyxl python-docx matplotlib 2>/dev/null || true' });
        logger.log('[sandbox] pre-installed Python packages');
      } catch (e) {
        logger.log('[sandbox] pip pre-install skipped:', (e as Error).message);
      }
    }
  }

  // Fallback: if sandbox not working, inline file content into message
  if (!sandboxWorking && uploadedFiles.length > 0) {
    logger.log('[fallback] sandbox unavailable, inlining file content into message');
    let inlineContent = '\n\n--- FILE CONTENTS (sandbox unavailable, analyze from text below) ---\n';
    for (const file of uploadedFiles) {
      try {
        const decoded = Buffer.from(file.base64, 'base64').toString('utf-8');
        inlineContent += `\n### File: ${file.name}\n\`\`\`\n${decoded}\n\`\`\`\n`;
      } catch { /* skip binary files */ }
    }
    message = message + inlineContent;
  }

  // Build Anthropic client
  // Strip trailing /v1 — SDK appends it automatically
  let baseURL = process.env.AI_GATEWAY_BASE_URL || "";
  baseURL = baseURL.replace(/\/v1\/?$/, "");

  const client = new Anthropic({
    apiKey: process.env.AI_GATEWAY_API_KEY!,
    baseURL,
    timeout: 300_000,
  });

  const model = resolveModelName();

  async function* generate(sig?: AbortSignal): AsyncGenerator<string> {
    // Build messages with conversation history
    const messages: Anthropic.MessageParam[] = [
      ...historyMessages,
      { role: "user", content: message },
    ];

    let fullAssistantText = "";
    let totalInput = 0;
    let totalOutput = 0;
    let turnCount = 0;
    const maxTurns = 30;

    while (turnCount < maxTurns) {
      turnCount++;
      if (sig?.aborted) break;

      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
        });
      } catch (apiError: any) {
        logger.error(
          "[api] messages.create failed:",
          apiError.message,
          apiError.status,
          apiError.error
        );
        yield sseEvent({
          type: "text_delta",
          delta: `\n\n❌ API 调用失败: ${apiError.message}`,
        });
        break;
      }

      totalInput += response.usage?.input_tokens || 0;
      totalOutput += response.usage?.output_tokens || 0;

      // Process response content blocks
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      let hasToolUse = false;

      for (const block of response.content) {
        if (block.type === "text") {
          const text = block.text || "";
          if (text) {
            // Filter out raw JSON tool_use that some models incorrectly embed in text
            // Remove any JSON objects that look like tool_use calls
            const cleaned = text
              .replace(/\{"type":"tool_use"[^}]*"input":\{[^}]*\}\}/g, "")
              .trim();
            if (cleaned) {
              fullAssistantText += cleaned;
              yield sseEvent({ type: "text_delta", delta: cleaned });
            }
          }
        } else if (block.type === "tool_use") {
          hasToolUse = true;
          const toolName = block.name;
          const toolInput = block.input as Record<string, any>;

          logger.log(
            `[tool] calling: ${toolName}`,
            JSON.stringify(toolInput).slice(0, 200)
          );
          yield sseEvent({
            type: "tool_called",
            tool: toolName,
            input: toolInput,
          });

          // Execute the sandbox tool
          let resultText: string;
          try {
            if (toolName === 'deliver_file') {
              // Custom tool: read file as base64 via commands tool and deliver to user
              const b64Result = await toolBundle.execute('commands', { cmd: `base64 -w 0 ${toolInput.path}` });
              let base64Content = '';
              try {
                const parsed = JSON.parse(b64Result);
                base64Content = (parsed.stdout || '').trim();
              } catch {
                base64Content = b64Result.trim();
              }
              if (!base64Content) throw new Error(`Failed to read file: ${toolInput.path}`);
              resultText = JSON.stringify({
                __file_output__: true,
                base64: base64Content,
                filename: toolInput.filename || toolInput.path.split('/').pop(),
                description: toolInput.description || '',
              });
            } else {
              resultText = await toolBundle.execute(toolName, toolInput);
            }
            logger.log(`[tool] ${toolName} success, result length: ${resultText.length}`);

            // Check if this is a file delivery result
            if (resultText.includes("__file_output__")) {
              try {
                const fileData = JSON.parse(resultText);
                if (fileData.__file_output__) {
                  yield sseEvent({
                    type: "file_output",
                    filename: fileData.filename,
                    base64: fileData.base64,
                    description: fileData.description,
                  });
                  resultText = `File "${fileData.filename}" has been delivered to the user for download.`;
                }
              } catch {
                /* not valid JSON, treat as normal result */
              }
            }

            // For code_interpreter, emit stdout as a code result for the user to see
            if (toolName === "code_interpreter") {
              try {
                const parsed = typeof resultText === 'string' ? JSON.parse(resultText) : resultText;
                const stdout = parsed.stdout || (parsed.logs?.stdout || []).join('') || '';
                const stderr = parsed.stderr || (parsed.logs?.stderr || []).join('') || parsed.error || '';
                if (stdout.trim()) {
                  yield sseEvent({
                    type: "code_output",
                    tool: toolName,
                    stdout: stdout,
                  });
                }
                if (stderr.trim()) {
                  yield sseEvent({
                    type: "code_output",
                    tool: toolName,
                    stderr: stderr,
                  });
                }
              } catch {
                // If resultText is plain text (not JSON), show it directly
                if (resultText.trim()) {
                  yield sseEvent({ type: "code_output", tool: toolName, stdout: resultText });
                }
              }
            }
          } catch (error) {
            resultText = `Error: ${
              error instanceof Error ? error.message : String(error)
            }`;
            logger.error(`[tool] ${toolName} error:`, resultText);
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: resultText,
          });
        }
      }

      // If no tool use, we're done
      if (!hasToolUse || response.stop_reason === "end_turn") {
        logger.log(
          `[loop] ending: hasToolUse=${hasToolUse}, stop_reason=${response.stop_reason}, turn=${turnCount}`
        );
        break;
      }

      // Continue the conversation with tool results
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    }

    // Emit usage
    yield sseEvent({
      type: "usage",
      input_tokens: totalInput,
      output_tokens: totalOutput,
      total_tokens: totalInput + totalOutput,
    });

    // Save assistant response to store
    if (store && conversationId && fullAssistantText.trim()) {
      try {
        await store.appendMessage({
          conversationId,
          role: "assistant",
          content: fullAssistantText,
        });
      } catch (e) {
        logger.error("[store] failed to save assistant response:", e);
      }
    }

    yield "data: [DONE]\n\n";
  }

  return createSSEResponse(generate, signal);
}
