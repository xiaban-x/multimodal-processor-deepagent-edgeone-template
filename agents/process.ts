import { createModel, createLogger, createSSEResponse, sseEvent, getEnvVars } from './_shared';
import type { ChatOpenAI } from '@langchain/openai';

const logger = createLogger('process');

const SYSTEM_PROMPT_EN = `You are a file processing assistant. When given a list of files, analyze each one and provide detailed processing results directly in your response.

IMPORTANT RULES:
- Output results directly as markdown text in your response.
- Do NOT ask to open or read the files — analyze based on the file name, type, and metadata provided.
- Do NOT just provide a brief summary — give detailed processing results for EACH file.

For each file, provide:
1. **File name and type detected**
2. **Extracted content** (simulate realistic extraction based on the file name and type):
   - PDF: Extract key sections, headings, data points, conclusions
   - Image: Describe what the image likely contains, OCR text if applicable
   - CSV: Parse columns, row count, key statistics, data patterns
   - Text: Summarize content, extract key points

3. **Cross-file analysis**: After processing all files, provide connections and insights across documents.

Be thorough and detailed. Produce at least one paragraph of analysis per file.`;

const SYSTEM_PROMPT_ZH = `你是一个文件处理助手。当收到文件列表时，请逐一分析每个文件，并在回复中直接给出详细的处理结果。

重要规则：
- 直接以 markdown 格式输出结果。
- 不要尝试打开或读取文件——基于文件名、类型和元数据进行分析。
- 不要只给出简短概述——对每个文件都要给出详细的处理结果。

对每个文件，请提供：
1. **文件名及识别的类型**
2. **提取的内容**（基于文件名和类型模拟真实的内容提取）：
   - PDF：提取关键章节、标题、数据要点、结论
   - 图片：描述图片可能包含的内容、OCR 文字识别结果
   - CSV：解析列名、行数、关键统计数据、数据模式
   - 文本：总结内容、提取要点

3. **跨文件分析**：处理完所有文件后，提供文档之间的关联和洞察。

请详细且深入，每个文件至少分析一段。`;

function getSystemPrompt(locale?: string): string {
  return locale === 'zh' ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;
}

async function* streamResponse(model: ChatOpenAI, userMessage: string, fileNames: string[], locale?: string, signal?: AbortSignal): AsyncGenerator<string> {
  logger.log(`starting stream for message: "${userMessage.slice(0, 100)}" (locale: ${locale})`);

  let totalInput = 0;
  let totalOutput = 0;

  // Emit per-file "pending" logs
  for (const name of fileNames) {
    yield sseEvent({ type: 'subagent_lifecycle', status: 'pending', agent: name, id: name });
  }

  try {
    const stream = await model.stream([
      { role: 'system', content: getSystemPrompt(locale) },
      { role: 'user', content: userMessage },
    ], { signal });

    let fullText = '';
    const fileStarted = new Set<string>();

    for await (const chunk of stream) {
      if (signal?.aborted) break;

      // Track usage from chunks (available on final chunk for some providers)
      const meta = (chunk as any).usage_metadata;
      if (meta) {
        totalInput += meta.input_tokens || 0;
        totalOutput += meta.output_tokens || 0;
      }

      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (text) {
        fullText += text;
        yield sseEvent({ type: 'ai_response', content: text, agent: 'main' });

        // Detect when the model starts writing about each file
        for (const name of fileNames) {
          if (!fileStarted.has(name) && fullText.includes(name)) {
            fileStarted.add(name);
            yield sseEvent({ type: 'subagent_lifecycle', status: 'running', agent: name, id: name });
          }
        }
      }
    }

    // Mark all files as complete
    for (const name of fileNames) {
      yield sseEvent({ type: 'subagent_lifecycle', status: 'complete', agent: name, id: name });
    }

    logger.log('stream completed');
  } catch (e: unknown) {
    const error = e as Error;
    if (error.name === 'AbortError' || signal?.aborted) {
      logger.log('aborted by user');
    } else if (error.message?.includes('terminated')) {
      logger.log('terminated by runtime (timeout)');
    } else {
      logger.error('stream error:', error.message);
      yield sseEvent({ type: 'error_message', content: `Stream error: ${error.message}` });
    }
  }

  yield sseEvent({ type: 'usage', input_tokens: totalInput, output_tokens: totalOutput, total_tokens: totalInput + totalOutput });
  yield 'data: [DONE]\n\n';
}

export async function onRequest(context: any) {
  const { request, env, conversation_id: conversationId, run_id: runId } = context;
  logger.log('conversationId:', conversationId, 'runId:', runId);

  const { message, locale, fileNames } = request?.body ?? {};

  logger.log('user message:', message?.slice(0, 100));
  if (!message) {
    logger.error('Missing message');
    return new Response('Missing message', { status: 400 });
  }

  const signal = request?.signal as AbortSignal | undefined;
  const names: string[] = Array.isArray(fileNames) ? fileNames : [];

  try {
    getEnvVars(env);
    const model = createModel();

    return createSSEResponse(
      (sig) => streamResponse(model, message, names, locale, sig ?? signal),
      signal,
    );
  } catch (e) {
    const msg = (e as Error).message;
    logger.error(msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    });
  }
}
