import Anthropic from '@anthropic-ai/sdk';
import { resolveModelName, collectGatewayEnv } from './_model';
import { createLogger } from './_shared';

const logger = createLogger('test');

export async function onRequest(context: any) {
  const { request } = context;
  const { message } = request?.body ?? {};
  logger.log('test message:', message);

  if (!message) {
    return new Response(JSON.stringify({ error: 'Missing message' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const env = collectGatewayEnv();

    const client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_API_KEY!,
      baseURL: env.ANTHROPIC_BASE_URL,
      timeout: 60_000,
    });

    const model = resolveModelName();
    logger.log(`Calling model: ${model}...`);

    const response = await client.messages.create({
      model,
      max_tokens: 256,
      messages: [{ role: 'user', content: message }],
      system: 'You are a test assistant. Reply with a short sentence to confirm you are working.',
    });

    const reply = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as any).text)
      .join('');

    logger.log('Reply:', reply);

    return new Response(JSON.stringify({
      status: 'ok',
      model,
      reply,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    logger.error('Error:', e.message);
    return new Response(JSON.stringify({
      status: 'error',
      model: resolveModelName(),
      error: e.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
