export async function onRequest(context: any) {
  const data = {
    status: 'ok',
    service: 'multimodal-processor',
    runId: context.run_id,
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}
