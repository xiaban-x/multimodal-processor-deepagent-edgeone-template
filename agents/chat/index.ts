/**
 * Document Processing Agent — EdgeOne Pages Functions
 * ====================================================
 *
 * File path: agents/chat/index.ts → maps to **POST /chat**
 *
 * Uses @anthropic-ai/sdk directly with manual tool-use loop.
 * Integrates EdgeOne sandbox tools (code_interpreter, commands, files).
 */

import Anthropic from '@anthropic-ai/sdk';
import { resolveModelName } from '../_model';
import { createLogger, sseEvent, createSSEResponse } from '../_shared';

const logger = createLogger('chat');

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
9. **In code_interpreter output, use clean print() without decorative separators (no "===", "---", "***" lines). Output data cleanly — the UI will format it.**`;

// Tool definitions for Anthropic SDK
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'commands',
    description: 'Execute shell commands in the sandbox (e.g., ffprobe, libreoffice, ls, cat)',
    input_schema: {
      type: 'object' as const,
      properties: {
        cmd: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'files',
    description: 'File operations in the sandbox — read, write, list, makeDir, exists, remove',
    input_schema: {
      type: 'object' as const,
      properties: {
        op: { type: 'string', enum: ['read', 'write', 'list', 'exists', 'remove', 'makeDir'], description: 'File operation' },
        path: { type: 'string', description: 'File or directory path' },
        content: { type: 'string', description: 'Content for write operation' },
      },
      required: ['op', 'path'],
    },
  },
  {
    name: 'code_interpreter',
    description: 'Run code in an isolated interpreter. Supports python, javascript, bash.',
    input_schema: {
      type: 'object' as const,
      properties: {
        language: { type: 'string', enum: ['python', 'javascript', 'bash'], description: 'Language to execute' },
        code: { type: 'string', description: 'Code to execute' },
      },
      required: ['language', 'code'],
    },
  },
  {
    name: 'deliver_file',
    description: 'Deliver a processed file to the user for download. Call this after generating an output file (e.g., merged PDF, converted document, analysis report). The file will be sent to the user as a downloadable link.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path to the output file in sandbox (e.g., /tmp/merged.pdf)' },
        filename: { type: 'string', description: 'Display filename for the user (e.g., merged-report.pdf)' },
        description: { type: 'string', description: 'Brief description of the file content' },
      },
      required: ['path', 'filename'],
    },
  },
];


/** Execute a sandbox tool using context.sandbox APIs */
async function executeSandboxTool(context: any, toolName: string, args: Record<string, any>): Promise<string> {
  const sandbox = context.sandbox;
  if (!sandbox) {
    throw new Error('Sandbox not available in this environment');
  }

  switch (toolName) {
    case 'commands': {
      try {
        const result = await sandbox.commands.run(args.cmd, {
          cwd: args.cwd || '/tmp',
          timeout: args.timeout || 60,
        });
        const exitCode = result.exitCode ?? result.exit_code ?? 0;
        return JSON.stringify({ stdout: result.stdout || '', stderr: result.stderr || '', exitCode });
      } catch (runError: any) {
        const stdout = runError.stdout || '';
        const stderr = runError.stderr || runError.message || String(runError);
        const exitCode = runError.exitCode ?? runError.exit_code ?? 1;
        return JSON.stringify({ stdout, stderr, exitCode });
      }
    }
    case 'files': {
      const op = args.op;
      switch (op) {
        case 'read':
          return await sandbox.files.read(args.path);
        case 'write':
          await sandbox.files.write(args.path, args.content || '');
          return JSON.stringify({ success: true });
        case 'list': {
          const entries = await sandbox.files.list(args.path);
          return JSON.stringify(entries);
        }
        case 'exists': {
          const exists = await sandbox.files.exists(args.path);
          return JSON.stringify(exists);
        }
        case 'remove':
          await sandbox.files.remove(args.path);
          return JSON.stringify({ success: true });
        case 'makeDir':
          await sandbox.files.makeDir(args.path);
          return JSON.stringify({ success: true });
        default:
          throw new Error(`Unknown files operation: ${op}`);
      }
    }
    case 'code_interpreter': {
      // Write code to a temp file then execute it (avoids shell quoting issues)
      const ext = args.language === 'python' ? 'py' : args.language === 'javascript' ? 'js' : 'sh';
      const scriptPath = `/tmp/_script_${Date.now()}.${ext}`;
      await sandbox.files.write(scriptPath, args.code);

      const cmd = args.language === 'python'
        ? `python3 ${scriptPath}`
        : args.language === 'bash'
        ? `bash ${scriptPath}`
        : `node ${scriptPath}`;

      try {
        const result = await sandbox.commands.run(cmd, { cwd: '/tmp', timeout: 120 });
        const exitCode = result.exitCode ?? result.exit_code ?? 0;
        // Cleanup script file
        try { await sandbox.files.remove(scriptPath); } catch { /* ignore */ }
        return JSON.stringify({ stdout: result.stdout || '', stderr: result.stderr || '', exitCode });
      } catch (runError: any) {
        // Some sandbox implementations throw on non-zero exit
        // Try to extract useful info from the error
        try { await sandbox.files.remove(scriptPath); } catch { /* ignore */ }
        const stdout = runError.stdout || '';
        const stderr = runError.stderr || runError.message || String(runError);
        const exitCode = runError.exitCode ?? runError.exit_code ?? 1;
        return JSON.stringify({ stdout, stderr, exitCode });
      }
    }
    case 'deliver_file': {
      // Read the file as base64 for delivery to client
      const filePath = args.path;
      const exists = await sandbox.files.exists(filePath);
      if (!exists) {
        throw new Error(`File not found: ${filePath}`);
      }
      // Read file as base64 using commands (handles binary files)
      const b64Result = await sandbox.commands.run(`base64 -w 0 ${filePath}`, { cwd: '/tmp', timeout: 30 });
      const base64Content = (b64Result.stdout || '').trim();
      if (!base64Content) {
        throw new Error(`Failed to read file: ${filePath}`);
      }
      return JSON.stringify({
        __file_output__: true,
        base64: base64Content,
        filename: args.filename || filePath.split('/').pop(),
        description: args.description || '',
      });
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}


export async function onRequest(context: any) {
  const body = context.request.body ?? {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const uploadedFiles: Array<{ name: string; base64: string }> = body.files ?? [];

  if (!message) {
    return new Response(
      JSON.stringify({ error: "'message' is required" }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const signal: AbortSignal | undefined = context.request.signal;
  // Use conversationId from request body (client-side), fallback to platform's
  const conversationId: string = body.conversationId || context.conversation_id || '';
  const store = context.store ?? null;

  logger.log(`[request] cid=${conversationId}, message="${message.slice(0, 80)}...", files=${uploadedFiles.length}`);
  logger.log(`[sandbox] available: ${!!context.sandbox}`);

  // Save user message to store
  if (store && conversationId) {
    try { await store.appendMessage({ conversationId, role: 'user', content: message }); }
    catch (e) { logger.error('[store] failed to save user message:', e); }
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
          if (msg.role === 'user' || msg.role === 'assistant') {
            // Truncate long messages to save tokens
            const content = (msg.content || '').slice(0, 2000);
            historyMessages.push({ role: msg.role, content });
          }
        }
        logger.log(`[history] loaded ${historyMessages.length} previous messages`);
      }
    } catch (e) {
      logger.error('[history] failed to load conversation history:', e);
    }
  }

  // Write uploaded files to sandbox before starting the Agent
  if (uploadedFiles.length > 0) {
    const sandbox = context.sandbox;
    if (sandbox) {
      for (const file of uploadedFiles) {
        try {
          const content = Buffer.from(file.base64, 'base64');
          await sandbox.files.write(`/tmp/${file.name}`, content);
          logger.log(`[upload] wrote file to sandbox: /tmp/${file.name} (${content.length} bytes)`);
        } catch (e) {
          // Retry once after short delay (handles ClientToken conflicts)
          try {
            await new Promise((r) => setTimeout(r, 500));
            const content = Buffer.from(file.base64, 'base64');
            await sandbox.files.write(`/tmp/${file.name}`, content);
            logger.log(`[upload] wrote file to sandbox (retry): /tmp/${file.name}`);
          } catch (e2) {
            logger.error(`[upload] failed to write /tmp/${file.name}:`, (e2 as Error).message);
          }
        }
      }

      // Pre-install commonly needed Python packages (saves agent turns + tokens)
      try {
        await sandbox.commands.run('pip install -q tabulate fpdf2 openpyxl python-docx 2>/dev/null || true', { cwd: '/tmp', timeout: 60 });
        logger.log('[sandbox] pre-installed Python packages');
      } catch (e) {
        logger.log('[sandbox] pip pre-install skipped:', (e as Error).message);
      }
    } else {
      logger.error('[upload] sandbox not available, cannot write uploaded files');
    }
  }

  // Build Anthropic client
  // Strip trailing /v1 — SDK appends it automatically
  let baseURL = process.env.AI_GATEWAY_BASE_URL || '';
  baseURL = baseURL.replace(/\/v1\/?$/, '');

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
      { role: 'user', content: message },
    ];

    let fullAssistantText = '';
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
        logger.error('[api] messages.create failed:', apiError.message, apiError.status, apiError.error);
        yield sseEvent({ type: 'text_delta', delta: `\n\n❌ API 调用失败: ${apiError.message}` });
        break;
      }

      totalInput += response.usage?.input_tokens || 0;
      totalOutput += response.usage?.output_tokens || 0;

      // Process response content blocks
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      let hasToolUse = false;

      for (const block of response.content) {
        if (block.type === 'text') {
          const text = block.text || '';
          if (text) {
            // Filter out raw JSON tool_use that some models incorrectly embed in text
            // Remove any JSON objects that look like tool_use calls
            const cleaned = text.replace(/\{"type":"tool_use"[^}]*"input":\{[^}]*\}\}/g, '').trim();
            if (cleaned) {
              fullAssistantText += cleaned;
              yield sseEvent({ type: 'text_delta', delta: cleaned });
            }
          }
        } else if (block.type === 'tool_use') {
          hasToolUse = true;
          const toolName = block.name;
          const toolInput = block.input as Record<string, any>;

          logger.log(`[tool] calling: ${toolName}`, JSON.stringify(toolInput).slice(0, 200));
          yield sseEvent({ type: 'tool_called', tool: toolName, input: toolInput });

          // Execute the sandbox tool
          let resultText: string;
          try {
            resultText = await executeSandboxTool(context, toolName, toolInput);
            logger.log(`[tool] ${toolName} success, result length: ${resultText.length}`);

            // Check if this is a file delivery result
            if (resultText.includes('__file_output__')) {
              try {
                const fileData = JSON.parse(resultText);
                if (fileData.__file_output__) {
                  yield sseEvent({
                    type: 'file_output',
                    filename: fileData.filename,
                    base64: fileData.base64,
                    description: fileData.description,
                  });
                  resultText = `File "${fileData.filename}" has been delivered to the user for download.`;
                }
              } catch { /* not valid JSON, treat as normal result */ }
            }

            // For code_interpreter, emit stdout as a code result for the user to see
            if (toolName === 'code_interpreter') {
              try {
                const parsed = JSON.parse(resultText);
                if (parsed.stdout && parsed.stdout.trim()) {
                  yield sseEvent({ type: 'code_output', tool: toolName, stdout: parsed.stdout });
                }
                if (parsed.stderr && parsed.stderr.trim()) {
                  yield sseEvent({ type: 'code_output', tool: toolName, stderr: parsed.stderr });
                }
              } catch { /* ignore parse errors */ }
            }
          } catch (error) {
            resultText = `Error: ${error instanceof Error ? error.message : String(error)}`;
            logger.error(`[tool] ${toolName} error:`, resultText);
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: resultText,
          });
        }
      }

      // If no tool use, we're done
      if (!hasToolUse || response.stop_reason === 'end_turn') {
        logger.log(`[loop] ending: hasToolUse=${hasToolUse}, stop_reason=${response.stop_reason}, turn=${turnCount}`);
        break;
      }

      // Continue the conversation with tool results
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
    }

    // Emit usage
    yield sseEvent({ type: 'usage', input_tokens: totalInput, output_tokens: totalOutput, total_tokens: totalInput + totalOutput });

    // Save assistant response to store
    if (store && conversationId && fullAssistantText.trim()) {
      try { await store.appendMessage({ conversationId, role: 'assistant', content: fullAssistantText }); }
      catch (e) { logger.error('[store] failed to save assistant response:', e); }
    }

    yield 'data: [DONE]\n\n';
  }

  return createSSEResponse(generate, signal);
}
