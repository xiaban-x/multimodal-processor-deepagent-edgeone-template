import { ChatOpenAI } from '@langchain/openai';

// --- Model ---

let cachedModel: ChatOpenAI | null = null;

/**
 * ChatOpenAI direct instantiation with caching.
 * - Avoids initChatModel OPENAI_API_KEY env check
 * - Does not pass temperature (some models only allow specific values)
 */
export function createModel(options?: { timeout?: number }): ChatOpenAI {
  if (cachedModel) return cachedModel;

  cachedModel = new ChatOpenAI({
    model: process.env.AI_MODEL || '@Pages/deepseek-v4-flash',
    apiKey: process.env.AI_GATEWAY_API_KEY!,
    configuration: {
      baseURL: process.env.AI_GATEWAY_BASE_URL!,
    },
    timeout: options?.timeout ?? 300_000,
  });

  return cachedModel;
}

// --- Environment ---

export interface EnvVars {
  AI_GATEWAY_API_KEY: string;
  AI_GATEWAY_BASE_URL: string;
}

export function getEnvVars(contextEnv?: Record<string, string | undefined>): EnvVars {
  const source = contextEnv ?? process.env;
  const required = ['AI_GATEWAY_API_KEY', 'AI_GATEWAY_BASE_URL'] as const;
  const missing = required.filter((k) => !source[k]?.trim());
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  return {
    AI_GATEWAY_API_KEY: source.AI_GATEWAY_API_KEY!,
    AI_GATEWAY_BASE_URL: source.AI_GATEWAY_BASE_URL!,
  };
}

// --- Logger ---

export function createLogger(name: string) {
  return {
    log(...args: unknown[]) {
      console.log(`[${name}][${new Date().toISOString()}]`, ...args);
    },
    error(...args: unknown[]) {
      console.error(`[${name}][${new Date().toISOString()}]`, ...args);
    },
  };
}

// --- SSE Helpers ---

export function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function createSSEResponse(
  generator: (signal?: AbortSignal) => AsyncGenerator<string>,
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(sseEvent({ type: 'ping', ts: Date.now() })));
        } catch { /* stream closed */ }
      }, 5_000);

      try {
        for await (const chunk of generator(signal)) {
          if (signal?.aborted) break;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (e) {
        const error = e as Error;
        // Handle EdgeOne runtime terminated error gracefully
        if (error.message?.includes('terminated') && signal?.aborted) {
          // Aborted with content already sent — not an error
        } else if (error.name !== 'AbortError' && !signal?.aborted) {
          controller.enqueue(
            encoder.encode(sseEvent({ type: 'error_message', content: error.message })),
          );
        }
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
    cancel() {
      // client disconnected
    },
  });

  return new Response(readableStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
