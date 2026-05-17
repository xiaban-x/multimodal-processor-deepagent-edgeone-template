import { createModel, createLogger, getEnvVars } from './_shared';

const logger = createLogger('summarize');

const SUMMARY_PROMPT_EN = `You are a cross-document summarization specialist. Given the processed results of multiple files, produce a comprehensive summary that:
1. Lists key findings from each file
2. Identifies connections, patterns, or relationships between documents
3. Highlights important data points
4. Provides an overall executive summary

Format your response as structured markdown with sections: ## Key Findings, ## Cross-File Connections, ## Summary`;

const SUMMARY_PROMPT_ZH = `你是一名跨文档摘要专家。给定多个文件的处理结果，请生成一份全面的摘要，包括：
1. 列出每个文件的关键发现
2. 识别文档之间的关联、模式或关系
3. 突出重要数据要点
4. 提供整体执行摘要

请用 markdown 格式输出，包含以下章节：## 关键发现, ## 跨文件关联, ## 总结`;

export async function onRequest(context: any) {
  const { request, env } = context;
  const { results, locale } = request?.body ?? {};

  if (!results || !Array.isArray(results) || results.length === 0) {
    return new Response(JSON.stringify({ error: 'Missing or empty results array' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    });
  }

  try {
    getEnvVars(env);
    const model = createModel({ timeout: 120_000 });

    const prompt = locale === 'zh' ? SUMMARY_PROMPT_ZH : SUMMARY_PROMPT_EN;

    const userContent = locale === 'zh'
      ? `以下是多个文件的处理结果：\n\n${results.map((r: any, i: number) => `### 文件 ${i + 1}：${r.filename}\n类型：${r.type}\n结果：\n${r.content}`).join('\n\n---\n\n')}`
      : `Here are the processed results from multiple files:\n\n${results.map((r: any, i: number) => `### File ${i + 1}: ${r.filename}\nType: ${r.type}\nResult:\n${r.content}`).join('\n\n---\n\n')}`;

    const response = await model.invoke([
      { role: 'system', content: prompt },
      { role: 'user', content: userContent },
    ]);

    const summary = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    return new Response(JSON.stringify({ summary }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    });
  } catch (e) {
    const msg = (e as Error).message;
    logger.error(msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    });
  }
}
