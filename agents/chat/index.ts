/**
 * Document Processing Agent — EdgeOne Makes Functions
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

// ============ Skills-Based Prompt Architecture ============
// Base prompt is always loaded. Skills are appended dynamically based on uploaded file types.

const BASE_PROMPT = `You are a professional document processing Agent running inside an EdgeOne sandbox environment.

## Available Sandbox Tools
- **commands**: Execute shell commands (ffprobe, ffmpeg, cat, ls, etc.)
- **files**: File operations — read, write, list, makeDir, exists, remove.
  Parameters: op (required), path (required), content (for write).
- **code_interpreter**: Run code in isolated interpreter.
  Parameters: language ("python"/"javascript"/"bash"), code (source code).

## Sandbox Environment
- Pre-installed Python packages (DO NOT pip install): pandas, openpyxl, Pillow, PyPDF2, pdfplumber, python-docx, fpdf2, tabulate, matplotlib, numpy
- Available commands: python3, node, ffprobe, ffmpeg, cat, ls, find, wc
- No apt-get/package manager. Use "pip install" ONLY for ImportError on packages NOT in the list above.

## Important Rules
1. Use tools — do NOT simulate or fake outputs. Actually call the tool.
2. Prefer code_interpreter with Python for document processing.
3. All uploaded files are at /tmp/<filename>. Do NOT search for files — they are already there.
4. Text results (tables, analysis) → output as clean Markdown. Binary files (PDF, images) → save to /tmp/ then call deliver_file.
5. After generating ANY file, IMMEDIATELY call deliver_file as your NEXT action. Do NOT verify/inspect the file.
6. NEVER embed tool call JSON in your text response. Always use proper tool_use blocks.
7. Respond in the same language as the user's message.
8. In code_interpreter, use clean print() — no decorative separators ("===", "---").
9. **SUGGESTIONS MUST USE THE TOOL**: NEVER write suggestions as text (numbered lists, "推荐方案" etc.). If you want to suggest options, STOP and call the suggest_actions tool. Text suggestions are invisible to users.
10. After calling suggest_actions, STOP immediately. No trailing text like "请选择" or "点击上方".

## Auto-Analysis on Upload
When user uploads files without a specific processing command:
1. Use code_interpreter (Python) to quickly check basic file info (2-3 lines of output)
2. Provide a brief summary of what the file contains
3. IMMEDIATELY call suggest_actions with 3-5 tailored options. End your response there.

## Always Suggest Next Actions
After EVERY response where the task is NOT fully complete, you MUST call suggest_actions. Exceptions:
- ❌ You just called deliver_file (task is done)
- ❌ User said "done" / "完成了" / "thank you"
- ❌ Problem requires user action outside chat (file upload failed, empty file) — just explain the issue

## Unsupported Requests
Say "抱歉，暂不支持这个操作" then call suggest_actions with alternatives the user CAN do.
`;

const SKILL_IMAGE = `## Loaded Skill: Image Processing
- Format conversion: Pillow (PIL) — PNG, JPEG, WebP, GIF, BMP, TIFF
- Compression: img.save(path, quality=X, optimize=True)
- Resize: img.resize((w, h), Image.LANCZOS)
- EXIF metadata: img._getexif() or img.info.get('dpi')
- OCR: Not natively available. Describe visible text content instead.
- SVG conversion: For simple line art → threshold to B/W + trace contours with Python. For photos → embed as base64 in SVG (explain this is not true vectorization). No potrace/ImageMagick available.
- Watermark: Use Pillow ImageDraw to overlay text
- Crop: img.crop((left, top, right, bottom))
`;

const SKILL_CSV = `## Loaded Skill: CSV & Data Analysis
- Read: pd.read_csv(path)
- Statistics: df.describe(), df.info(), df.value_counts()
- Visualization: matplotlib charts (bar, line, pie, scatter, heatmap)
- Export: df.to_excel(path), df.to_markdown(tablefmt='pipe')
- Profiling: column types, null counts, unique values, correlations
- Filtering: df.query(), df[condition], groupby/aggregate
`;

const SKILL_PDF = `## Loaded Skill: PDF Processing
- Extract text: pdfplumber.open(path).pages[i].extract_text()
- Extract tables: page.extract_tables() → returns list of lists
- Merge PDFs: PyPDF2.PdfMerger().append(path)
- Page info: PdfReader(path).pages, len(reader.pages)
- Metadata: reader.metadata (title, author, etc.)
`;

const SKILL_WORD = `## Loaded Skill: Word Document Processing
- Read: from docx import Document; doc = Document(path)
- Extract text: [p.text for p in doc.paragraphs]
- Extract tables: doc.tables → table.rows, row.cells
- Convert to PDF: Read content with python-docx, render with matplotlib PdfPages (see PDF Generation skill)
`;

const SKILL_EXCEL = `## Loaded Skill: Excel Processing
- Read all sheets: pd.read_excel(path, sheet_name=None) → dict of DataFrames
- Single sheet: pd.read_excel(path, sheet_name='Sheet1')
- To Markdown: df.to_markdown(tablefmt='pipe')
- Statistics: df.describe() per sheet
- Charts: matplotlib from DataFrame data
- Export CSV: df.to_csv(path, index=False)
`;

const SKILL_VIDEO = `## Loaded Skill: Video Processing
- Metadata: ffprobe -v quiet -print_format json -show_format -show_streams <file>
- Thumbnail: ffmpeg -i <file> -ss 00:00:01 -vframes 1 /tmp/thumb.jpg
- Info extraction: duration, resolution, codec, bitrate, fps from ffprobe JSON
- Note: Cannot transcode or edit video content in this environment, only extract metadata/thumbnails.
`;

const SKILL_PDF_GENERATION = `## Loaded Skill: PDF Generation (Chinese Content)
When generating PDF with Chinese text, use matplotlib + PdfPages (NOT fpdf2):
\`\`\`python
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.font_manager import FontProperties

font = FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')

with PdfPages('/tmp/report.pdf') as pdf:
    fig, ax = plt.subplots(figsize=(8.27, 11.69))  # A4
    ax.axis('off')
    ax.text(0.5, 0.95, 'Title', fontsize=16, fontproperties=font, ha='center', va='top')
    ax.text(0.05, 0.85, 'Content...', fontsize=10, fontproperties=font, va='top', wrap=True)
    pdf.savefig(fig)
    plt.close()
\`\`\`
- Tables in PDF: use ax.table() from matplotlib
- fpdf2 with Helvetica is OK for English-only content
- DO NOT use fpdf2 for Chinese (TTC font = garbled output)
- After generating PDF, IMMEDIATELY call deliver_file
`;

const SKILL_MIXED = `## Loaded Skill: Multi-File Operations
When processing multiple files together:
- Cross-file analysis: Read all files, find connections/patterns, generate unified insights
- Merge into PDF: Combine content from all files into one structured report
- Compare: Diff or contrast data across files
- Summary report: Extract key info from each file, synthesize into cohesive analysis
- Process sequentially, report progress for each file
`;

const SKILL_TEXT = `## Loaded Skill: Text/Markdown/JSON Processing
- Read content: Use files tool (op: read) or code_interpreter
- Summarize: Extract key points, generate concise summary
- Reformat: Convert between Markdown/JSON/plain text formats
- Translate: Translate content between languages
- Analyze structure: For JSON, parse and describe schema; for Markdown, extract headings/sections
- Word count, character count, readability analysis
- Convert to PDF: Render text content as formatted PDF (use matplotlib PdfPages for Chinese)
`;

/** Build system prompt dynamically based on uploaded file types */
function buildSystemPrompt(files: Array<{name: string}>, sandboxWorking: boolean): string {
  const skills = new Set<string>();

  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) skills.add('image');
    else if (['csv'].includes(ext)) skills.add('csv');
    else if (['pdf'].includes(ext)) skills.add('pdf');
    else if (['doc', 'docx'].includes(ext)) skills.add('word');
    else if (['xls', 'xlsx'].includes(ext)) skills.add('excel');
    else if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) skills.add('video');
    else if (['md', 'txt', 'json', 'xml', 'html', 'log', 'yml', 'yaml'].includes(ext)) skills.add('text');
    else skills.add('text'); // unknown extensions → text skill
  }

  // Multiple file types → load mixed skill
  if (skills.size > 1) skills.add('mixed');

  // PDF generation skill loaded when user might want PDF output
  const needsPdfGen = skills.has('csv') || skills.has('excel') || skills.has('mixed') || skills.has('word') || skills.has('text') || skills.has('pdf');

  let prompt = BASE_PROMPT;
  if (skills.has('image')) prompt += '\n\n' + SKILL_IMAGE;
  if (skills.has('csv')) prompt += '\n\n' + SKILL_CSV;
  if (skills.has('pdf')) prompt += '\n\n' + SKILL_PDF;
  if (skills.has('word')) prompt += '\n\n' + SKILL_WORD;
  if (skills.has('excel')) prompt += '\n\n' + SKILL_EXCEL;
  if (skills.has('video')) prompt += '\n\n' + SKILL_VIDEO;
  if (skills.has('text')) prompt += '\n\n' + SKILL_TEXT;
  if (skills.has('mixed')) prompt += '\n\n' + SKILL_MIXED;
  if (needsPdfGen) prompt += '\n\n' + SKILL_PDF_GENERATION;

  if (!sandboxWorking) {
    prompt += `\n\n## IMPORTANT: Sandbox Unavailable Mode
The sandbox is NOT available. File contents have been inlined in the message.
- Do NOT call commands, files, or code_interpreter — they will fail.
- Analyze content directly from the message text.
- Only suggest text-based operations (summarize, analyze, compare, translate).
- You MUST still call suggest_actions to present options.`;
  }

  const loadedSkills = Array.from(skills).join(', ');
  logger.log(`[prompt] skills loaded: ${loadedSkills}, pdfGen: ${needsPdfGen}, sandbox: ${sandboxWorking}`);

  return prompt;
}

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

/**
 * Helper: build tool executor from context.tools
 * Per docs: use context.tools.get(name).execute(args) — tools are atomic (files_read, files_write, etc.)
 * Result format: {content: [{type:'text', text:'...'}]} or plain string
 */
function buildToolExecutors(context: any): { execute: (name: string, args: Record<string, any>) => Promise<string>; ready: boolean } {
  if (typeof context.tools?.get !== 'function') {
    logger.error('[tools] context.tools.get not available');
    return { execute: async () => { throw new Error('No tools available'); }, ready: false };
  }

  // Verify at least one key tool exists
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

  // Direct sandbox access (faster, bypasses MCP tool layer)
  const sandbox = context.sandbox ?? null;

  // Write uploaded files to sandbox before starting the Agent
  let sandboxWorking = false;
  if (uploadedFiles.length > 0 && (toolBundle.ready || sandbox)) {
    // Test sandbox readiness — prefer direct sandbox API
    try {
      if (sandbox?.commands?.run) {
        await sandbox.commands.run('ls /tmp', { timeout: 10 });
        sandboxWorking = true;
        logger.log('[sandbox] ready (direct API)');
      } else {
        await toolBundle.execute('commands', { cmd: 'ls /tmp' });
        sandboxWorking = true;
        logger.log('[sandbox] ready (via tools)');
      }
    } catch (e) {
      // Retry with delay
      for (let attempt = 0; attempt < 2; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          if (sandbox?.commands?.run) {
            await sandbox.commands.run('ls /tmp', { timeout: 10 });
          } else {
            await toolBundle.execute('commands', { cmd: 'ls /tmp' });
          }
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

          // Helper: run a shell command via the best available method
          const runCmd = async (cmd: string): Promise<string> => {
            if (sandbox?.commands?.run) {
              const r = await sandbox.commands.run(cmd, { timeout: 30 });
              return r.stdout || '';
            }
            const r = await toolBundle.execute('commands', { cmd });
            try { return JSON.parse(r).stdout || ''; } catch { return r; }
          };

          // Helper: write text to sandbox file
          const writeText = async (path: string, content: string): Promise<void> => {
            if (sandbox?.files?.write) {
              await sandbox.files.write(path, content);
            } else {
              await toolBundle.execute('files_write', { path, content });
            }
          };

          // Strategy: write base64 as text file → decode with shell command
          // sandbox.files.write() accepts strings, perfect for base64 text
          try {
            const b64TmpPath = '/tmp/__upload_b64.tmp';
            await writeText(b64TmpPath, file.base64);
            await runCmd(`base64 -d ${b64TmpPath} > ${shellQuote(sandboxPath)} && rm -f ${b64TmpPath}`);

            // Verify
            const sizeStr = await runCmd(`stat -c %s ${shellQuote(sandboxPath)} 2>/dev/null || echo 0`);
            const fileSize = parseInt(sizeStr.trim(), 10) || 0;
            if (fileSize > 0) {
              uploadSuccess = true;
              logger.log(`[upload] success via files.write+decode: ${sandboxPath} (${fileSize} bytes)`);
            }
          } catch (e) {
            logger.log(`[upload] files.write method failed: ${(e as Error).message}`);
          }

          // Fallback: use runCode (Python) if files.write approach failed
          if (!uploadSuccess) {
            try {
              const runCode = sandbox?.runCode
                ? (code: string) => sandbox.runCode(code, { language: 'python' })
                : (code: string) => toolBundle.execute('code_interpreter', { language: 'python', code });

              // For small files, do it in one shot
              if (file.base64.length <= 150_000) {
                await runCode(`import base64\nwith open("${sandboxPath}", "wb") as f:\n    f.write(base64.b64decode("${file.base64}"))\nprint("ok")`);
              } else {
                // Write base64 chunks to temp file, then decode
                const chunkSize = 150_000;
                const totalChunks = Math.ceil(file.base64.length / chunkSize);
                await runCode(`open("/tmp/__b64tmp", "w").close()`);
                for (let i = 0; i < totalChunks; i++) {
                  const chunk = file.base64.slice(i * chunkSize, (i + 1) * chunkSize);
                  await runCode(`open("/tmp/__b64tmp", "a").write("${chunk}")`);
                }
                await runCode(`import base64, os\nwith open("/tmp/__b64tmp") as f:\n    d = base64.b64decode(f.read())\nwith open("${sandboxPath}", "wb") as f:\n    f.write(d)\nos.remove("/tmp/__b64tmp")\nprint(len(d))`);
              }

              const sizeStr = await runCmd(`stat -c %s ${shellQuote(sandboxPath)} 2>/dev/null || echo 0`);
              const fileSize = parseInt(sizeStr.trim(), 10) || 0;
              if (fileSize > 0) {
                uploadSuccess = true;
                logger.log(`[upload] success via runCode: ${sandboxPath} (${fileSize} bytes)`);
              }
            } catch (e) {
              logger.log(`[upload] runCode method failed: ${(e as Error).message}`);
            }
          }

          if (!uploadSuccess) {
            logger.error(`[upload] ALL methods failed for ${file.name}`);
            sandboxWorking = false;
            break;
          }
        } catch (e) {
          logger.error(`[upload] failed for ${file.name}:`, (e as Error).message);
          sandboxWorking = false;
          break;
        }
      }
    }

    // Tell the AI files are ready — no need to list /tmp
    if (sandboxWorking) {
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
  const baseURL = process.env.AI_GATEWAY_BASE_URL || "";

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
    let suggestActionsCalled = false;
    let deliverFileCalled = false;

    while (turnCount < maxTurns) {
      turnCount++;
      if (sig?.aborted) break;

      let response: Anthropic.Message;
      // When sandbox is unavailable, only expose suggest_actions tool
      const activeTools = sandboxWorking ? TOOLS : TOOLS.filter(t => t.name === 'suggest_actions');
      // Build dynamic prompt based on file types (skills architecture)
      const systemPrompt = buildSystemPrompt(uploadedFiles, sandboxWorking);
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
              suggestActionsCalled = true;
              yield sseEvent({
                type: "suggest_actions",
                actions: toolInput.actions || [],
              });
              resultText = 'Suggestions have been displayed to the user. Wait for them to choose an action.';
            } else if (toolName === 'deliver_file') {
              deliverFileCalled = true;
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

            logger.log(`[tool] ${toolName} success, result length: ${resultText.length}`);

            // Check if this is a file delivery result (BEFORE truncation — base64 is large)
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

            // Truncate excessively long tool results to prevent request body overflow
            // (applied AFTER file_output extraction so base64 data isn't lost)
            if (resultText.length > 8000) {
              resultText = resultText.slice(0, 8000) + '\n...[truncated, result too long]';
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

    // FALLBACK: If AI didn't call suggest_actions and didn't deliver a file, auto-generate suggestions
    if (!suggestActionsCalled && !deliverFileCalled && uploadedFiles.length > 0) {
      logger.log('[fallback] AI did not call suggest_actions, generating default suggestions');
      const fileTypes = new Set(uploadedFiles.map(f => {
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
        if (['pdf'].includes(ext)) return 'pdf';
        if (['doc', 'docx'].includes(ext)) return 'word';
        if (['xls', 'xlsx'].includes(ext)) return 'excel';
        if (['csv'].includes(ext)) return 'csv';
        if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
        return 'text';
      }));

      const defaultActions: Array<{ id: string; emoji: string; title: string; description: string }> = [];
      if (fileTypes.has('image')) {
        defaultActions.push(
          { id: 'a1', emoji: '🔄', title: '格式转换', description: '将图片转换为 PNG、WebP 等其他格式' },
          { id: 'a2', emoji: '📦', title: '压缩图片', description: '压缩图片文件大小，优化存储' },
          { id: 'a3', emoji: '🔍', title: 'OCR 文字识别', description: '识别图片中的文字内容' },
          { id: 'a4', emoji: '📐', title: '调整尺寸', description: '调整图片尺寸或裁剪' },
        );
      } else if (fileTypes.has('pdf')) {
        defaultActions.push(
          { id: 'a1', emoji: '📝', title: '提取文字', description: '从 PDF 中提取全部文本内容' },
          { id: 'a2', emoji: '📊', title: '提取表格', description: '提取 PDF 中的表格数据' },
          { id: 'a3', emoji: '📋', title: '生成摘要', description: '总结 PDF 文档的核心内容' },
          { id: 'a4', emoji: '🔗', title: '合并 PDF', description: '与其他 PDF 文件合并' },
        );
      } else if (fileTypes.has('word')) {
        defaultActions.push(
          { id: 'a1', emoji: '📄', title: '转换为 PDF', description: '将 Word 文档转换为 PDF 格式' },
          { id: 'a2', emoji: '📝', title: '提取文字', description: '提取文档中的全部文本' },
          { id: 'a3', emoji: '📊', title: '提取表格', description: '提取文档中的表格数据' },
          { id: 'a4', emoji: '📋', title: '内容摘要', description: '生成文档核心内容摘要' },
        );
      } else if (fileTypes.has('csv') || fileTypes.has('excel')) {
        defaultActions.push(
          { id: 'a1', emoji: '📊', title: '数据分析', description: '统计分析并生成摘要' },
          { id: 'a2', emoji: '📈', title: '生成图表', description: '将数据可视化为图表' },
          { id: 'a3', emoji: '📄', title: '导出 PDF 报告', description: '生成格式化的 PDF 数据报告' },
        );
      } else {
        // text/md/json/etc.
        defaultActions.push(
          { id: 'a1', emoji: '📋', title: '内容摘要', description: '提取核心内容生成摘要' },
          { id: 'a2', emoji: '📄', title: '转换为 PDF', description: '将文本内容排版为 PDF 文件' },
          { id: 'a3', emoji: '🔍', title: '结构分析', description: '分析文件结构和关键信息' },
          { id: 'a4', emoji: '🌐', title: '翻译', description: '将内容翻译为其他语言' },
        );
      }

      yield sseEvent({ type: "suggest_actions", actions: defaultActions });
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
