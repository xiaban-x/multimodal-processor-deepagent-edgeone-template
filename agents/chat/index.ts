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
- **SVG conversion**: Use Pillow to trace/convert. For simple images (icons, line art), threshold to black/white then trace contours with Python. For complex photos, embed as base64 in SVG (not true vectorization — explain to user). Do NOT rely on potrace or ImageMagick — they are not available.

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
7. **CRITICAL: For text results (tables, analysis, summaries), output directly in your response as clean Markdown. For generated binary files (PDF, images, etc.), save to /tmp/ then ALWAYS call the deliver_file tool to send it to the user for download. NEVER skip the deliver_file step — the user cannot access files unless you deliver them.**
8. Always respond in the same language as the user's message.
9. **In code_interpreter output, use clean print() without decorative separators (no "===", "---", "***" lines). Output data cleanly — the UI will format it.**
10. **PDF GENERATION: Use matplotlib + PdfPages for Chinese PDF. DO NOT use fpdf2 for Chinese text (produces garbled output). See PDF Generation Rules section for the exact pattern.**
11. **NEVER embed tool call JSON in your text response. Always use proper tool_use blocks. If you need to run code, call the code_interpreter tool — do NOT paste the code as text.**

## Auto-Analysis on Upload

When the user uploads files without giving a specific processing command (e.g., "请分析这些文件" or "analyze these files"):
1. Use code_interpreter (Python with Pillow/pandas/PyPDF2) to quickly check basic file info (dimensions, size, format, row count, etc.)
2. Provide a brief 2-3 line summary of what each file contains
3. **IMMEDIATELY call the suggest_actions tool** to present clickable options. Provide 3-5 actions tailored to the file types:
   - Image file → convert format, compress, extract text (OCR), resize, add watermark
   - CSV file → generate PDF report, data visualization, export Excel, statistics
   - PDF file → extract text, merge PDFs, convert to Word, extract tables
   - Word file → convert to PDF, extract text, analyze structure
   - Multiple files → cross-file operations (merge, compare, summary report)
4. After calling suggest_actions, do NOT output any additional text. No "click above" or "let me know" — the cards speak for themselves. End your response immediately after the tool call.
5. **NEVER output suggestions as plain text.** Always use the suggest_actions tool for this purpose.

## CRITICAL: Always Suggest Next Actions

After EVERY response where the task is NOT fully completed, you MUST call suggest_actions to present follow-up options. Specifically:
- ✅ After initial file analysis → suggest processing options
- ✅ After partial processing (e.g., extracted text but user may want more) → suggest further actions
- ✅ After answering a question about the files → suggest related operations
- ✅ After an error where you can suggest alternative processing on existing files

The ONLY time you should NOT call suggest_actions is:
- ❌ After calling deliver_file (task is complete, user got their file)
- ❌ After user explicitly says "thank you" / "done" / "完成了"
- ❌ When the problem requires user action outside the chat (e.g., file upload failed / file is empty / file is corrupted) — just explain the issue clearly and let the user re-upload manually. Do NOT suggest "重新上传" as an action — you cannot trigger uploads.

This makes the UI consistently interactive — users always see clickable next steps.
**IMPORTANT: After calling suggest_actions, STOP. Do not add any trailing text like "请选择" or "点击上方按钮". The tool call must be the last thing in your response.**

## Unsupported Request Handling

If the user asks something you cannot do (e.g., send emails, browse the internet, access real-time data, communicate with external services):
1. Politely say: "抱歉，暂不支持这个操作。" (or English equivalent)
2. Call suggest_actions with 2-3 things the user CAN do with their current files
3. If no files are uploaded, suggest uploading files first
4. Never show raw error messages or expose technical limitations to the user`;

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
  {
    name: "suggest_actions",
    description:
      "Present a list of recommended actions to the user as clickable options. Use this when you've analyzed files and want to suggest processing options. The user will click one to proceed.",
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
        let tool = context.tools.get(name);
        // Retry with alternate naming (e.g., files_list, files_read)
        if (!tool || typeof tool.execute !== 'function') {
          // Try without underscores or with different casing
          tool = context.tools.get(name.replace(/_/g, '-'));
        }
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const TEXT_FALLBACK_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.tsx',
  '.py',
  '.log',
  '.yml',
  '.yaml',
  '.sql',
]);

function canInlineFallbackFile(fileName: string, content: Buffer): boolean {
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
    // Test sandbox readiness — use 'commands' (always available), NOT 'files' (split into files_read etc.)
    try {
      await toolBundle.execute('commands', { cmd: 'ls /tmp' });
      sandboxWorking = true;
      logger.log('[sandbox] ready');
    } catch (e) {
      // Retry with delay
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          await toolBundle.execute('commands', { cmd: 'ls /tmp' });
          sandboxWorking = true;
          logger.log(`[sandbox] ready (after ${attempt + 1} retries)`);
          break;
        } catch {
          logger.log(`[sandbox] not ready, retrying... (attempt ${attempt + 1})`);
        }
      }
    }

    if (sandboxWorking) {
      for (const file of uploadedFiles) {
        try {
          const sandboxPath = `/tmp/${file.name}`;
          let uploadSuccess = false;

          // Method 1: Use code_interpreter (Python) — most reliable for all filenames and sizes
          try {
            // Split base64 into chunks small enough for code_interpreter input
            const b64 = file.base64;
            const pyChunkSize = 200_000;
            if (b64.length <= pyChunkSize) {
              await toolBundle.execute('code_interpreter', {
                language: 'python',
                code: `import base64\ndata = base64.b64decode("${b64}")\nwith open("${sandboxPath}", "wb") as f:\n    f.write(data)\nprint(f"Written {len(data)} bytes")`,
              });
            } else {
              // Write base64 string in chunks, then decode
              const totalChunks = Math.ceil(b64.length / pyChunkSize);
              let pyCode = `import base64\nb64_str = ""\n`;
              // Write chunks to a temp file to avoid huge Python string
              await toolBundle.execute('code_interpreter', {
                language: 'python',
                code: `open("/tmp/__upload_b64.txt", "w").close()`,
              });
              for (let i = 0; i < totalChunks; i++) {
                const chunk = b64.slice(i * pyChunkSize, (i + 1) * pyChunkSize);
                await toolBundle.execute('code_interpreter', {
                  language: 'python',
                  code: `with open("/tmp/__upload_b64.txt", "a") as f:\n    f.write("${chunk}")`,
                });
              }
              await toolBundle.execute('code_interpreter', {
                language: 'python',
                code: `import base64, os\nwith open("/tmp/__upload_b64.txt", "r") as f:\n    b64_str = f.read()\ndata = base64.b64decode(b64_str)\nwith open("${sandboxPath}", "wb") as f:\n    f.write(data)\nos.remove("/tmp/__upload_b64.txt")\nprint(f"Written {len(data)} bytes to ${sandboxPath}")`,
              });
            }

            // Verify
            const verifyResult = await toolBundle.execute('commands', { cmd: `stat -c %s ${shellQuote(sandboxPath)} 2>/dev/null || echo MISSING` });
            const verifyStr = typeof verifyResult === 'string' ? verifyResult : JSON.stringify(verifyResult);
            if (!verifyStr.includes('MISSING') && !verifyStr.includes('"stdout":""') && !verifyStr.includes('"stdout":"0\n"')) {
              uploadSuccess = true;
            }
          } catch (e) {
            logger.log(`[upload] Python method failed for ${file.name}: ${(e as Error).message}`);
          }

          // Method 2 fallback: Use shell commands
          if (!uploadSuccess) {
            try {
              if (file.base64.length > 500_000) {
                const chunkSize = 400_000;
                const totalChunks = Math.ceil(file.base64.length / chunkSize);
                await toolBundle.execute('commands', { cmd: `> ${shellQuote(sandboxPath)}.b64` });
                for (let i = 0; i < totalChunks; i++) {
                  const chunk = file.base64.slice(i * chunkSize, (i + 1) * chunkSize);
                  await toolBundle.execute('commands', {
                    cmd: `printf %s ${shellQuote(chunk)} >> ${shellQuote(sandboxPath)}.b64`,
                  });
                }
                await toolBundle.execute('commands', {
                  cmd: `base64 -d ${shellQuote(sandboxPath)}.b64 > ${shellQuote(sandboxPath)} && rm -f ${shellQuote(sandboxPath)}.b64`,
                });
              } else {
                await toolBundle.execute('commands', {
                  cmd: `printf %s ${shellQuote(file.base64)} | base64 -d > ${shellQuote(sandboxPath)}`,
                });
              }

              const verifyResult = await toolBundle.execute('commands', { cmd: `stat -c %s ${shellQuote(sandboxPath)} 2>/dev/null || echo MISSING` });
              const verifyStr = typeof verifyResult === 'string' ? verifyResult : JSON.stringify(verifyResult);
              if (!verifyStr.includes('MISSING') && !verifyStr.includes('"stdout":""') && !verifyStr.includes('"stdout":"0\n"')) {
                uploadSuccess = true;
              }
            } catch (e2) {
              logger.log(`[upload] Shell method also failed for ${file.name}: ${(e2 as Error).message}`);
            }
          }

          if (!uploadSuccess) {
            logger.error(`[upload] ALL methods failed for ${file.name}`);
            sandboxWorking = false;
            break;
          }
          logger.log(`[upload] verified: ${sandboxPath} (${(file.base64.length / 1024).toFixed(0)}KB b64)`);
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

      // Tell the AI files are ready — no need to list /tmp
      const fileList = uploadedFiles.map(f => `/tmp/${f.name}`).join(', ');
      message = message + `\n\n[系统提示：文件已就绪，路径为: ${fileList}。请直接分析和处理，不需要先 list 目录确认。]`;
    }
  }

  // Fallback: if sandbox not working, inline text file content into message
  if (!sandboxWorking && uploadedFiles.length > 0) {
    logger.log('[fallback] sandbox unavailable, inlining text file content into message');
    let inlineContent = '\n\n--- FILE CONTENTS (sandbox unavailable, analyze text files below) ---\n';
    const skippedFiles: string[] = [];

    for (const file of uploadedFiles) {
      try {
        const content = Buffer.from(file.base64, 'base64');
        if (!canInlineFallbackFile(file.name, content)) {
          skippedFiles.push(file.name);
          continue;
        }

        const decoded = content.toString('utf8');
        inlineContent += `\n### File: ${file.name}\n\`\`\`\n${decoded}\n\`\`\`\n`;
      } catch {
        skippedFiles.push(file.name);
      }
    }

    if (skippedFiles.length > 0) {
      inlineContent += `\nSkipped binary or non-text files because sandbox is unavailable: ${skippedFiles.join(', ')}\n`;
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
    const maxTurns = 15;

    while (turnCount < maxTurns) {
      turnCount++;
      if (sig?.aborted) break;

      let response: Anthropic.Message;
      // When sandbox is unavailable, only expose suggest_actions tool
      const activeTools = sandboxWorking ? TOOLS : TOOLS.filter(t => t.name === 'suggest_actions');
      const systemPrompt = sandboxWorking ? SYSTEM_PROMPT : SYSTEM_PROMPT + `

## IMPORTANT: Sandbox Unavailable Mode
The sandbox is NOT available in this session. File contents have been inlined in the user message.
- Do NOT call commands, files, or code_interpreter tools — they will fail.
- Analyze the file content directly from the message text.
- For suggest_actions, only suggest text-based operations (summarize, analyze, compare, extract key points, translate). Do NOT suggest PDF generation, format conversion, or chart creation.
- You MUST still call suggest_actions to present follow-up options after your analysis.`;
      try {
        response = await client.messages.create({
          model,
          max_tokens: 8192,
          system: systemPrompt,
          tools: activeTools,
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
            // This handles deeply nested JSON (e.g., code_interpreter with multi-line code)
            let cleaned = text;
            // Remove JSON objects that look like tool_use calls (greedy match for nested braces)
            cleaned = cleaned.replace(/\{"type"\s*:\s*"tool_use"[\s\S]*?"input"\s*:\s*\{[\s\S]*?\}\s*\}/g, "");
            // Also remove standalone JSON tool call blocks that start with {"id": "toolu_...
            cleaned = cleaned.replace(/\{"id"\s*:\s*"toolu_[^"]*"[\s\S]*?"input"\s*:\s*\{[\s\S]*?\}\s*\}/g, "");
            // Remove any remaining large JSON blobs (likely tool artifacts) — >200 chars of JSON
            cleaned = cleaned.replace(/\{[^{}]{200,}\}/g, (match) => {
              // Only remove if it looks like a tool call (has "name"/"input"/"code"/"language" keys)
              if (match.includes('"name"') && (match.includes('"input"') || match.includes('"code"'))) return "";
              return match;
            });
            cleaned = cleaned.trim();
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
            if (toolName === 'suggest_actions') {
              // Custom tool: emit structured suggestion card to frontend
              yield sseEvent({
                type: "suggest_actions",
                actions: toolInput.actions || [],
              });
              resultText = 'Suggestions have been displayed to the user. Wait for them to choose an action.';
            } else if (toolName === 'deliver_file') {
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
            } else if (toolName === 'files') {
              // Map composite 'files' tool to split tools: files_read, files_write, files_list, etc.
              const op = toolInput.op;
              const mappedName = `files_${op === 'makeDir' ? 'make_dir' : op}`;
              const mappedArgs: Record<string, any> = { path: toolInput.path };
              if (op === 'write' && toolInput.content) mappedArgs.content = toolInput.content;
              resultText = await toolBundle.execute(mappedName, mappedArgs);
            } else {
              resultText = await toolBundle.execute(toolName, toolInput);
            }

            // Truncate excessively long tool results to prevent request body overflow
            if (resultText.length > 8000) {
              resultText = resultText.slice(0, 8000) + '\n...[truncated, result too long]';
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

            // For code_interpreter, emit only clean stdout for the user to see
            // Errors and raw JSON are kept internal (model sees them in tool_result)
            if (toolName === "code_interpreter") {
              try {
                const parsed = typeof resultText === 'string' ? JSON.parse(resultText) : resultText;
                const stdoutArr = parsed.logs?.stdout || [];
                const stdout = Array.isArray(stdoutArr) ? stdoutArr.join('') : (parsed.stdout || '');
                // Only emit stdout (user-visible output), skip stderr/errors/raw JSON
                if (stdout.trim()) {
                  yield sseEvent({
                    type: "code_output",
                    tool: toolName,
                    stdout: stdout,
                  });
                }
                // Do NOT emit stderr or error tracebacks to the user
              } catch {
                // If resultText is plain text (not JSON), show it directly
                // but filter out anything that looks like a raw JSON blob
                if (resultText.trim() && !resultText.trim().startsWith('{')) {
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

      // If no tool use, we're done. Only break when there is genuinely no tool_use block.
      // When hasToolUse is true we MUST continue the loop regardless of stop_reason,
      // because the model may emit text + tool_use in one response with stop_reason=end_turn.
      if (!hasToolUse) {
        logger.log(
          `[loop] ending: no tool_use, stop_reason=${response.stop_reason}, turn=${turnCount}`
        );
        break;
      }

      // Continue the conversation with tool results
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    }

    // If loop ended without producing any text (e.g., maxTurns hit), emit a fallback message
    if (!fullAssistantText.trim() && turnCount >= maxTurns) {
      const fallbackMsg = '\n\n⚠️ 处理超时，请尝试简化操作或重新上传文件。';
      yield sseEvent({ type: "text_delta", delta: fallbackMsg });
      fullAssistantText += fallbackMsg;
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
