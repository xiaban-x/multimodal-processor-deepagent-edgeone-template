import { createModel, createLogger, getEnvVars } from './_shared';

const logger = createLogger('test');

export async function onRequest(context: any) {
  const { request, env } = context;
  const { message } = request?.body ?? {};
  logger.log('test message:', message);

  if (!message) {
    return new Response(JSON.stringify({ error: 'Missing message' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    getEnvVars(env);
    const model = createModel({ timeout: 60_000 });

    logger.log('Calling model.invoke (simple, no agent overhead)...');
    const response = await model.invoke([
      { role: 'system', content: 'You are a test assistant. Reply with a short sentence to confirm you are working.' },
      { role: 'user', content: message },
    ]);

    const reply = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    logger.log('Reply:', reply);

    return new Response(JSON.stringify({
      status: 'ok',
      model: process.env.AI_MODEL || '@Pages/deepseek-v4-flash',
      reply,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    logger.error('Error:', e.message);
    return new Response(JSON.stringify({
      status: 'error',
      model: process.env.AI_MODEL || '@Pages/deepseek-v4-flash',
      error: e.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
