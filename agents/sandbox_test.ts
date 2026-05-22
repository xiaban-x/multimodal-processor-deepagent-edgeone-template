/**
 * POST /sandbox_test
 * 测试不同沙箱工具执行方式，场景：写入文件 → 读回文件
 */

export async function onRequest(context: any) {
  const results: Record<string, any> = {};
  const testContent = 'Hello EdgeOne Sandbox! 你好沙箱！ ' + new Date().toISOString();
  const testPath = '/tmp/sandbox-test-file.txt';

  // ========== 方式1: context.tools.toClaudeMcpServer() ==========
  try {
    const mcpServer = context.tools.toClaudeMcpServer();
    // 列出可用工具
    const toolList = mcpServer?.tools?.map((t: any) => t.name) || [];
    results['method1_toClaudeMcpServer'] = {
      status: 'available',
      tools: toolList,
      note: 'This is for MCP integration with Claude SDK, not direct execution'
    };
  } catch (e: any) {
    results['method1_toClaudeMcpServer'] = { status: 'error', error: e.message };
  }

  // ========== 方式2: context.tools.get(name).execute() ==========
  try {
    // 2a: 用 commands 写文件
    const commandsTool = context.tools.get('commands');
    if (commandsTool) {
      const writeResult = await commandsTool.execute({
        command: `echo '${testContent}' > ${testPath}`
      });
      const readResult = await commandsTool.execute({
        command: `cat ${testPath}`
      });
      results['method2_tools_get_commands'] = {
        status: 'success',
        writeResult: JSON.stringify(writeResult).substring(0, 500),
        readResult: JSON.stringify(readResult).substring(0, 500),
        match: JSON.stringify(readResult).includes('Hello EdgeOne Sandbox')
      };
    } else {
      results['method2_tools_get_commands'] = { status: 'not_found', error: 'commands tool not available' };
    }
  } catch (e: any) {
    results['method2_tools_get_commands'] = { status: 'error', error: e.message, stack: e.stack?.substring(0, 300) };
  }

  // 2b: 用 files 工具
  try {
    const filesTool = context.tools.get('files');
    if (filesTool) {
      const writeResult = await filesTool.execute({
        action: 'write',
        path: '/tmp/sandbox-test-files-api.txt',
        content: testContent
      });
      const readResult = await filesTool.execute({
        action: 'read',
        path: '/tmp/sandbox-test-files-api.txt'
      });
      results['method2_tools_get_files'] = {
        status: 'success',
        writeResult: JSON.stringify(writeResult).substring(0, 500),
        readResult: JSON.stringify(readResult).substring(0, 500),
        match: JSON.stringify(readResult).includes('Hello EdgeOne Sandbox')
      };
    } else {
      results['method2_tools_get_files'] = { status: 'not_found', error: 'files tool not available' };
    }
  } catch (e: any) {
    results['method2_tools_get_files'] = { status: 'error', error: e.message, stack: e.stack?.substring(0, 300) };
  }

  // 2c: 用 code_interpreter 工具
  try {
    const codeTool = context.tools.get('code_interpreter');
    if (codeTool) {
      const codeResult = await codeTool.execute({
        code: `
with open('${testPath}', 'w') as f:
    f.write('${testContent}')
with open('${testPath}', 'r') as f:
    print(f.read())
`
      });
      results['method2_tools_get_code_interpreter'] = {
        status: 'success',
        result: JSON.stringify(codeResult).substring(0, 500),
        match: JSON.stringify(codeResult).includes('Hello EdgeOne Sandbox')
      };
    } else {
      results['method2_tools_get_code_interpreter'] = { status: 'not_found', error: 'code_interpreter tool not available' };
    }
  } catch (e: any) {
    results['method2_tools_get_code_interpreter'] = { status: 'error', error: e.message, stack: e.stack?.substring(0, 300) };
  }

  // ========== 方式3: context.tools.all() 遍历 ==========
  try {
    const allTools = context.tools.all();
    const toolNames = allTools.map((t: any) => t.name || t.type || 'unknown');
    results['method3_tools_all'] = {
      status: 'success',
      count: allTools.length,
      tools: toolNames
    };
  } catch (e: any) {
    results['method3_tools_all'] = { status: 'error', error: e.message };
  }

  // ========== 方式4: context.sandbox.commands.run() ==========
  try {
    if (context.sandbox?.commands?.run) {
      const writeRes = await context.sandbox.commands.run(`echo '${testContent}' > /tmp/sandbox-direct-test.txt`);
      const readRes = await context.sandbox.commands.run('cat /tmp/sandbox-direct-test.txt');
      results['method4_sandbox_commands_run'] = {
        status: 'success',
        writeRes: JSON.stringify(writeRes).substring(0, 500),
        readRes: JSON.stringify(readRes).substring(0, 500),
        match: JSON.stringify(readRes).includes('Hello EdgeOne Sandbox')
      };
    } else {
      results['method4_sandbox_commands_run'] = { status: 'not_available', error: 'context.sandbox.commands.run not found' };
    }
  } catch (e: any) {
    results['method4_sandbox_commands_run'] = { status: 'error', error: e.message, stack: e.stack?.substring(0, 300) };
  }

  // ========== 方式5: context.sandbox.files.write() / read() ==========
  try {
    if (context.sandbox?.files?.write) {
      const writeRes = await context.sandbox.files.write('/tmp/sandbox-files-direct.txt', testContent);
      const readRes = await context.sandbox.files.read('/tmp/sandbox-files-direct.txt');
      results['method5_sandbox_files'] = {
        status: 'success',
        writeRes: JSON.stringify(writeRes).substring(0, 500),
        readRes: JSON.stringify(readRes).substring(0, 500),
        match: JSON.stringify(readRes).includes('Hello EdgeOne Sandbox')
      };
    } else {
      results['method5_sandbox_files'] = { status: 'not_available', error: 'context.sandbox.files not found' };
    }
  } catch (e: any) {
    results['method5_sandbox_files'] = { status: 'error', error: e.message, stack: e.stack?.substring(0, 300) };
  }

  // ========== 方式6: AI 调用工具写文件再读回 (完整 tool-use 循环) ==========
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({
      apiKey: process.env.AI_GATEWAY_API_KEY || '',
      baseURL: (process.env.AI_GATEWAY_BASE_URL || '').replace(/\/v1\/?$/, ''),
    });

    const tools = [
      {
        name: 'write_file',
        description: 'Write content to a file in the sandbox',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'File path' },
            content: { type: 'string', description: 'File content' }
          },
          required: ['path', 'content']
        }
      },
      {
        name: 'read_file',
        description: 'Read content from a file in the sandbox',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'File path' }
          },
          required: ['path']
        }
      }
    ];

    const messages: any[] = [
      { role: 'user', content: `Please write the text "${testContent}" to /tmp/ai-test-output.txt using write_file, then read it back using read_file and show me the content.` }
    ];

    let aiResult: any = null;
    let rounds = 0;
    const maxRounds = 5;

    while (rounds < maxRounds) {
      rounds++;
      const response = await client.messages.create({
        model: '@Pages/deepseek-v4-flash',
        max_tokens: 1024,
        tools,
        messages,
      });

      if (response.stop_reason === 'end_turn' || !response.content.some((b: any) => b.type === 'tool_use')) {
        aiResult = response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        break;
      }

      // Process tool calls
      const assistantContent = response.content;
      messages.push({ role: 'assistant', content: assistantContent });

      const toolResults: any[] = [];
      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          let result = '';
          try {
            if (block.name === 'write_file') {
              const commandsTool = context.tools.get('commands');
              if (commandsTool) {
                const b64 = Buffer.from(block.input.content).toString('base64');
                await commandsTool.execute({ command: `echo '${b64}' | base64 -d > ${block.input.path}` });
                result = `File written to ${block.input.path}`;
              } else {
                result = 'commands tool not available';
              }
            } else if (block.name === 'read_file') {
              const commandsTool = context.tools.get('commands');
              if (commandsTool) {
                const readRes = await commandsTool.execute({ command: `cat ${block.input.path}` });
                result = typeof readRes === 'string' ? readRes : JSON.stringify(readRes);
              } else {
                result = 'commands tool not available';
              }
            }
          } catch (e: any) {
            result = `Error: ${e.message}`;
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    results['method6_ai_tool_use_loop'] = {
      status: 'success',
      rounds,
      aiResult: (aiResult || '').substring(0, 500),
      match: (aiResult || '').includes('Hello EdgeOne Sandbox')
    };
  } catch (e: any) {
    results['method6_ai_tool_use_loop'] = { status: 'error', error: e.message, stack: e.stack?.substring(0, 300) };
  }

  // ========== 汇总 ==========
  const summary = Object.entries(results).map(([method, res]) => ({
    method,
    status: res.status,
    match: res.match ?? null,
  }));

  return new Response(JSON.stringify({ summary, details: results }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}
