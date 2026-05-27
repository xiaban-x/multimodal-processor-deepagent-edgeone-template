'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { marked } from 'marked';
import { useI18n } from '@/lib/i18n';

// Configure marked for GFM tables
marked.setOptions({ gfm: true, breaks: true });

// ============ Types ============

export interface FileItem {
  id: string;
  name: string;
  type: 'pdf' | 'image' | 'video' | 'word' | 'excel' | 'csv' | 'text';
  size: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  base64?: string;
}

interface ActivityEntry {
  id: string;
  timestamp: number;
  type: 'user' | 'text' | 'tool_call' | 'tool_output' | 'file_download' | 'error' | 'system' | 'suggestions';
  content: string;
  meta?: Record<string, any>;
}

// ============ Markdown Renderer ============

/**
 * Renders markdown using `marked` (string-based HTML output).
 * Avoids react-markdown's key="" bug with GFM tables entirely.
 */
function MarkdownBlock({ content }: { content: string }) {
  const html = marked.parse(content) as string;
  return <div className="prose-chat" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** For streaming text: plain text during streaming, rendered markdown after done */
function StreamingText({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  if (isStreaming) {
    return <pre className="prose-chat whitespace-pre-wrap text-sm font-sans">{content}</pre>;
  }
  return <MarkdownBlock content={content} />;
}

// ============ Helpers ============

function getFileType(name: string): FileItem['type'] {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['xls', 'xlsx'].includes(ext)) return 'excel';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
  if (['csv'].includes(ext)) return 'csv';
  return 'text';
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function timeStr(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

/** Map tool names to human-readable agent descriptions */
function toolToAgentAction(tool: string, input: any, locale: string): string {
  const isZh = locale === 'zh';
  switch (tool) {
    case 'files': {
      const op = input?.op;
      const path = input?.path || '';
      const fname = path.split('/').pop();
      if (op === 'read') return isZh ? `📖 读取文件 ${fname}` : `📖 Reading ${fname}`;
      if (op === 'write') return isZh ? `✍️ 写入文件 ${fname}` : `✍️ Writing ${fname}`;
      if (op === 'list') return isZh ? `📂 列出目录 ${path}` : `📂 Listing ${path}`;
      if (op === 'exists') return isZh ? `🔍 检查文件 ${fname}` : `🔍 Checking ${fname}`;
      if (op === 'makeDir') return isZh ? `📁 创建目录 ${path}` : `📁 Creating dir ${path}`;
      if (op === 'remove') return isZh ? `🗑️ 删除文件 ${fname}` : `🗑️ Removing ${fname}`;
      return isZh ? `📄 文件操作: ${op}` : `📄 File op: ${op}`;
    }
    case 'commands': {
      const cmd = (input?.cmd || '').slice(0, 120);
      if (cmd.includes('pip install')) return isZh ? `📦 准备处理环境...` : `📦 Preparing environment...`;
      if (cmd.includes('ffprobe') || cmd.includes('ffmpeg')) {
        // Check if it's actually image-related
        if (cmd.match(/\.(png|jpg|jpeg|gif|webp|bmp|svg)/i)) return isZh ? `🖼️ 分析图片信息` : `🖼️ Analyzing image`;
        return isZh ? `🎬 分析媒体信息` : `🎬 Analyzing media`;
      }
      if (cmd.includes('base64')) return isZh ? `📤 准备文件下载` : `📤 Preparing download`;
      if (cmd.includes('file ') || cmd.includes('identify')) return isZh ? `🔍 检查文件信息` : `🔍 Checking file info`;
      return isZh ? `⚡ 正在处理...` : `⚡ Processing...`;
    }
    case 'code_interpreter': {
      const lang = input?.language || 'python';
      const code = (input?.code || '').slice(0, 80);
      if (code.includes('pandas') || code.includes('pd.read_csv')) return isZh ? `🐍 Python 数据分析中...` : `🐍 Python data analysis...`;
      if (code.includes('FPDF') || code.includes('fpdf')) return isZh ? `🐍 Python 生成 PDF...` : `🐍 Python generating PDF...`;
      if (code.includes('matplotlib') || code.includes('plt.')) return isZh ? `📊 Python 生成图表...` : `📊 Python creating chart...`;
      if (code.includes('docx') || code.includes('Document')) return isZh ? `🐍 Python 处理 Word 文档...` : `🐍 Python processing Word doc...`;
      return isZh ? `🐍 ${lang} 代码执行中...` : `🐍 Running ${lang} code...`;
    }
    case 'deliver_file': {
      const fname = input?.filename || '';
      return isZh ? `📥 交付文件: ${fname}` : `📥 Delivering: ${fname}`;
    }
    default:
      return isZh ? `🔧 ${tool}` : `🔧 ${tool}`;
  }
}

// ============ Sample Files ============

const SAMPLE_FILES: Omit<FileItem, 'base64'>[] = [
  { id: 's1', name: 'quarterly-report.txt', type: 'text', size: '2.1 KB', status: 'queued' },
  { id: 's2', name: 'project-plan.md', type: 'text', size: '1.5 KB', status: 'queued' },
  { id: 's3', name: 'sales-data.csv', type: 'csv', size: '380 B', status: 'queued' },
  { id: 's4', name: 'team-contacts.csv', type: 'csv', size: '260 B', status: 'queued' },
];

function generateSampleContent(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  let text = '';
  if (ext === 'txt') {
    text = 'Quarterly Financial Report 2024 Q4\n====================================\n\nRevenue: $2.4B (+15% YoY)\nNet Profit: $340M (+22% YoY)\nOperating Margin: 28%\n\nKey Highlights:\n- Expanded into 3 new markets\n- Customer base grew 22%\n- Reduced operational costs by 18%\n- Launched AI-powered product suite\n\nRevenue Breakdown:\n- Enterprise: $1.2B (50%)\n- SMB: $720M (30%)\n- Consumer: $480M (20%)';
  } else if (ext === 'md') {
    text = '# Project Plan: AI Integration 2025\n\n## Phase 1: Research (Jan-Mar)\n- Evaluate LLM providers\n- Build POC\n\n## Phase 2: Development (Apr-Jun)\n- API architecture\n- RAG pipeline\n- Testing framework\n\n## Phase 3: Launch (Jul-Sep)\n- Beta testing\n- Customer pilot\n- Production deployment\n\n## Team\n| Role | Name | Allocation |\n|------|------|---|\n| Tech Lead | Alice | 100% |\n| Backend | Bob | 100% |\n| ML | Eric | 100% |\n| PM | Fiona | 50% |';
  } else if (ext === 'csv' && name.includes('sales')) {
    text = 'Product,Q1_Revenue,Q2_Revenue,Q3_Revenue,Q4_Revenue,Unit_Price,Units_Sold\nWidget Pro,45000,52000,61000,72000,299,241\nWidget Lite,28000,31000,35000,42000,149,282\nWidget Enterprise,120000,135000,155000,180000,999,180\nCloud Suite,85000,95000,110000,128000,599,214\nData Toolkit,32000,38000,44000,51000,199,256\nAI Assistant,15000,42000,68000,95000,399,238\nMobile App,22000,25000,29000,34000,99,343\nAPI Gateway,55000,62000,71000,82000,499,164';
  } else if (ext === 'csv') {
    text = 'Name,Email,Department,Role,Location,Start_Date\nAlice Chen,alice@company.com,Engineering,Tech Lead,Beijing,2020-03-15\nBob Wang,bob@company.com,Engineering,Senior Engineer,Shanghai,2021-06-01\nCharlie Liu,charlie@company.com,Engineering,Engineer,Shenzhen,2022-01-10\nDiana Zhang,diana@company.com,Product,Product Manager,Beijing,2021-09-20\nEric Li,eric@company.com,Engineering,ML Engineer,Hangzhou,2023-02-28\nFiona Wu,fiona@company.com,Product,Senior PM,Beijing,2019-11-05\nGrace Huang,grace@company.com,Design,UI Designer,Shanghai,2022-07-15';
  } else {
    text = `Sample content for ${name}`;
  }
  return btoa(unescape(encodeURIComponent(text)));
}

// ============ Main Component ============

export default function Home() {
  const { t, locale, setLocale } = useI18n();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [conversationId] = useState(() => crypto.randomUUID());
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0 });
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const activityEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // IME composition tracking
  const isComposingRef = useRef(false);
  const pendingAutoAnalyze = useRef(false);

  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activities]);

  // Theme class on html
  useEffect(() => {
    document.documentElement.className = theme;
  }, [theme]);

  const addActivity = useCallback((type: ActivityEntry['type'], content: string, meta?: Record<string, any>) => {
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setActivities((prev) => [...prev, { id, timestamp: Date.now(), type, content, meta }]);
  }, []);

  // File handling
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const items: FileItem[] = await Promise.all(
      selectedFiles.map(async (f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        type: getFileType(f.name),
        size: f.size > 1024 * 1024 ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` : `${(f.size / 1024).toFixed(0)} KB`,
        status: 'queued' as const,
        base64: await readFileAsBase64(f),
      }))
    );
    setFiles((prev) => [...prev, ...items]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    pendingAutoAnalyze.current = true;
  }, []);

  const loadSamples = useCallback(() => {
    const items: FileItem[] = SAMPLE_FILES.map((f) => ({
      ...f, id: crypto.randomUUID(), base64: generateSampleContent(f.name),
    }));
    setFiles(items);
    pendingAutoAnalyze.current = true;
  }, []);

  // Send message
  const sendMessage = useCallback(async (customMsg?: string, silent?: boolean) => {
    const text = customMsg || userInput.trim();
    if (!text || isProcessing) return;
    setIsProcessing(true);
    setUserInput('');

    const queuedFiles = files.filter((f) => f.status === 'queued');
    let fullMessage = text;
    const filesToUpload: Array<{ name: string; base64: string }> = [];

    if (queuedFiles.length > 0) {
      const desc = queuedFiles.map((f) => `- ${f.name} (${f.type}, ${f.size})`).join('\n');
      fullMessage = `${text}\n\n上传的文件：\n${desc}`;
      for (const f of queuedFiles) {
        if (f.base64) filesToUpload.push({ name: f.name, base64: f.base64 });
      }
    }

    // Append language preference for file generation
    const langHint = locale === 'zh'
      ? '\n\n[语言要求：所有输出内容（包括生成的文件、报告标题、表头等）必须使用中文]'
      : '\n\n[Language: All output (including generated files, report titles, headers) must be in English]';
    fullMessage += langHint;

    if (silent) {
      // Auto-triggered: show friendly system message instead of raw prompt
      const fileCount = queuedFiles.length || files.length;
      const msg = locale === 'zh' ? `📎 已接收 ${fileCount} 份文件，正在分析...` : `📎 Received ${fileCount} file(s), analyzing...`;
      addActivity('system', msg);
    } else {
      addActivity('user', text);
    }
    addActivity('system', t.startProcessing);

    try {
      const resp = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: fullMessage, conversationId, files: filesToUpload.length > 0 ? filesToUpload : undefined }),
      });

      if (!resp.ok) {
        let errMsg = `HTTP ${resp.status}`;
        try {
          const errBody = await resp.text();
          if (resp.status === 429 || errBody.includes("quota")) {
            errMsg = t.quotaExhausted;
          } else if (errBody) {
            errMsg = errBody.slice(0, 200);
          }
        } catch {}
        throw new Error(errMsg);
      }
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentText = '';
      let currentTextId = '';
      // Defer suggest_actions to display at the very end
      let pendingSuggestions: Array<{ id: string; emoji: string; title: string; description: string }> | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          try {
            const event = JSON.parse(payload);

            if (event.type === 'text_delta' && event.delta) {
              currentText += event.delta;
              // Capture snapshot to avoid stale closure (React batches state updates)
              const snapshot = currentText;
              if (!currentTextId) {
                currentTextId = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const newId = currentTextId;
                setActivities((prev) => {
                  // Guard: don't append if already exists (React StrictMode / batching)
                  if (prev.some((a) => a.id === newId)) return prev.map((a) => a.id === newId ? { ...a, content: snapshot } : a);
                  return [...prev, { id: newId, timestamp: Date.now(), type: 'text' as const, content: snapshot }];
                });
              } else {
                const updateId = currentTextId;
                setActivities((prev) => prev.map((a) => a.id === updateId ? { ...a, content: snapshot } : a));
              }
            } else if (event.type === 'tool_called' && event.tool) {
              // Reset text for next text block
              currentText = '';
              currentTextId = '';
              // Don't show suggest_actions as a tool call — it's handled via its own event
              if (event.tool !== 'suggest_actions') {
                const agentAction = toolToAgentAction(event.tool, event.input, locale);
                // Collapse repeated tool_call entries with same label — update last one instead of creating new
                setActivities((prev) => {
                  const lastIdx = prev.length - 1;
                  if (lastIdx >= 0 && prev[lastIdx].type === 'tool_call' && prev[lastIdx].content === agentAction) {
                    // Same action repeated — just keep the existing one (don't spam)
                    return prev;
                  }
                  return [...prev, { id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now(), type: 'tool_call' as const, content: agentAction, meta: { tool: event.tool } }];
                });
              }
            } else if (event.type === 'suggest_actions' && event.actions) {
              // Defer suggestions — render at the very end of the response
              pendingSuggestions = event.actions;
            } else if (event.type === 'code_output') {
              // Only show errors, hide normal stdout (technical logs)
              if (event.stderr?.trim()) addActivity('error', event.stderr);
            } else if (event.type === 'file_output' && event.filename) {
              addActivity('file_download', event.filename, { base64: event.base64, description: event.description });
            } else if (event.type === 'usage') {
              setTokenUsage((prev) => ({ input: prev.input + (event.input_tokens || 0), output: prev.output + (event.output_tokens || 0) }));
            }
          } catch { /* skip */ }
        }
      }

      // Render deferred suggestions at the very end (after all text/tool outputs)
      if (pendingSuggestions) {
        addActivity('suggestions', '', { actions: pendingSuggestions });
      } else {
        // Clean up trailing "recommendation intro" text if AI wrote it without calling the tool
        setActivities((prev) => {
          const last = prev[prev.length - 1];
          if (last?.type === 'text' && last.content) {
            // Remove trailing lines that introduce suggestions that never came
            const cleaned = last.content.replace(/\n*(?:以下是|请选择|请点击|点击上方|您可以选择|推荐的处理方案|以下是为您推荐)[\s\S]*$/, '').trim();
            if (cleaned !== last.content && cleaned) {
              return prev.map((a) => a.id === last.id ? { ...a, content: cleaned } : a);
            }
          }
          return prev;
        });
        addActivity('system', t.taskComplete);
      }
    } catch (err) {
      addActivity('error', `${(err as Error).message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [userInput, files, isProcessing, conversationId, addActivity, locale]);

  // Auto-trigger analysis when files are added
  useEffect(() => {
    if (pendingAutoAnalyze.current && files.length > 0 && !isProcessing) {
      pendingAutoAnalyze.current = false;
      // Pass special flag to avoid showing raw prompt as user message
      sendMessage(t.suggestPrompt, true);
    }
  }, [files, isProcessing, sendMessage, t.suggestPrompt]);

  const isDark = theme === 'dark';

  return (
    <div className={`h-screen flex flex-col ${isDark ? 'bg-gray-950 text-gray-100' : 'bg-white text-gray-900'}`}>
      {/* Header */}
      <header className={`flex-shrink-0 border-b ${isDark ? 'border-gray-800' : 'border-gray-200'} px-5 py-2.5 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`} />
          <h1 className="text-sm font-mono font-bold tracking-wide">
            {locale === 'zh' ? '智能文档处理 Agent' : 'DOC-PROCESSOR AGENT'}
          </h1>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          {tokenUsage.input > 0 && (
            <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
              {(tokenUsage.input + tokenUsage.output).toLocaleString()} tokens
            </span>
          )}
          <button onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            className={`px-2 py-1 rounded ${isDark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'} transition-colors`}>
            {locale === 'zh' ? 'EN' : '中'}
          </button>
          <button onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className={`px-2 py-1 rounded ${isDark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'} transition-colors`}>
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar — Files */}
        <aside className={`w-56 flex-shrink-0 border-r ${isDark ? 'border-gray-800' : 'border-gray-200'} flex flex-col`}>
          <div className={`p-3 border-b ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
            <div className="flex gap-1">
              <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing}
                className={`flex-1 px-2 py-1.5 text-xs font-mono rounded border transition-colors disabled:opacity-50 ${isDark ? 'bg-gray-800 hover:bg-gray-700 border-gray-700' : 'bg-gray-50 hover:bg-gray-100 border-gray-200'}`}>
                + {locale === 'zh' ? '上传' : 'Upload'}
              </button>
              {files.length > 0 && (
                <button onClick={() => setFiles([])} disabled={isProcessing}
                  className={`px-2 py-1.5 text-xs font-mono rounded border transition-colors disabled:opacity-50 ${isDark ? 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-red-400' : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-red-500'}`}>
                  ×
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.avi,.mkv,.txt,.md" />
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {files.map((f) => (
              <div key={f.id} className={`px-2 py-1.5 rounded flex items-center gap-2 group ${isDark ? 'bg-gray-900 border border-gray-800' : 'bg-gray-50 border border-gray-100'}`}>
                <span className={`text-[10px] font-mono px-1 py-0.5 rounded uppercase ${isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>{f.type.slice(0, 3)}</span>
                <span className={`text-xs font-mono truncate flex-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{f.name}</span>
                <button
                  onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                  className={`opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1 rounded ${isDark ? 'text-gray-500 hover:text-red-400 hover:bg-gray-800' : 'text-gray-400 hover:text-red-500 hover:bg-gray-100'}`}
                >×</button>
              </div>
            ))}
            {files.length === 0 && (
              <p className={`text-xs text-center py-6 font-mono ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                {locale === 'zh' ? '暂无文件' : 'No files'}
              </p>
            )}
          </div>

          {/* Quick Actions */}
          {files.length > 0 && !isProcessing && (
            <div className={`p-2 border-t ${isDark ? 'border-gray-800' : 'border-gray-200'} space-y-1`}>
              <p className={`text-[10px] font-mono uppercase tracking-wider px-1 mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {locale === 'zh' ? '快捷操作' : 'Quick Actions'}
              </p>
              {files.some((f) => f.type === 'csv') && (
                <button onClick={() => sendMessage(locale === 'zh' ? '将所有 CSV 转为 Markdown 表格并做统计分析' : 'Convert all CSV to Markdown tables with stats')}
                  className={`w-full text-left px-2 py-1.5 text-xs font-mono rounded border transition-colors ${isDark ? 'text-green-400 bg-green-950/30 hover:bg-green-950/50 border-green-900/50' : 'text-green-700 bg-green-50 hover:bg-green-100 border-green-200'}`}>
                  ▸ CSV → {locale === 'zh' ? '表格+统计' : 'Table+Stats'}
                </button>
              )}
              {files.length > 0 && (
                <button onClick={() => sendMessage(locale === 'zh' ? '读取所有文件内容并给出摘要总结' : 'Read all files and summarize')}
                  className={`w-full text-left px-2 py-1.5 text-xs font-mono rounded border transition-colors ${isDark ? 'text-blue-400 bg-blue-950/30 hover:bg-blue-950/50 border-blue-900/50' : 'text-blue-700 bg-blue-50 hover:bg-blue-100 border-blue-200'}`}>
                  ▸ {locale === 'zh' ? '全部摘要' : 'Summarize All'}
                </button>
              )}
              {files.some((f) => f.type === 'pdf') && (
                <button onClick={() => sendMessage(locale === 'zh' ? '提取所有 PDF 文本' : 'Extract all PDF text')}
                  className={`w-full text-left px-2 py-1.5 text-xs font-mono rounded border transition-colors ${isDark ? 'text-red-400 bg-red-950/30 hover:bg-red-950/50 border-red-900/50' : 'text-red-700 bg-red-50 hover:bg-red-100 border-red-200'}`}>
                  ▸ {locale === 'zh' ? 'PDF 提取' : 'PDF Extract'}
                </button>
              )}
              {files.some((f) => f.type === 'word') && (
                <button onClick={() => sendMessage(locale === 'zh' ? '将 Word 转为 PDF 并发给我' : 'Convert Word to PDF and deliver')}
                  className={`w-full text-left px-2 py-1.5 text-xs font-mono rounded border transition-colors ${isDark ? 'text-purple-400 bg-purple-950/30 hover:bg-purple-950/50 border-purple-900/50' : 'text-purple-700 bg-purple-50 hover:bg-purple-100 border-purple-200'}`}>
                  ▸ Word → PDF
                </button>
              )}
              {files.some((f) => f.type === 'excel') && (
                <button onClick={() => sendMessage(locale === 'zh' ? '将 Excel 转为 Markdown 表格' : 'Convert Excel to Markdown')}
                  className={`w-full text-left px-2 py-1.5 text-xs font-mono rounded border transition-colors ${isDark ? 'text-emerald-400 bg-emerald-950/30 hover:bg-emerald-950/50 border-emerald-900/50' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'}`}>
                  ▸ Excel → Markdown
                </button>
              )}
            </div>
          )}
        </aside>

        {/* Main Area — Activity Feed */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {activities.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-xs">
                  <p className={`text-sm mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {t.emptyHint}
                  </p>
                  <p className={`text-xs font-medium mb-4 px-3 py-1.5 rounded-full inline-block ${isDark ? 'bg-blue-900/30 text-blue-300 border border-blue-800/50' : 'bg-blue-50 text-blue-600 border border-blue-200'}`}>
                    {t.supportedTypes}
                  </p>
                  <div>
                    <button onClick={loadSamples} disabled={isProcessing}
                      className={`px-4 py-2 text-xs rounded-lg border transition-colors disabled:opacity-50 ${isDark ? 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300' : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600'}`}>
                      {t.importSample}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activities.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 min-w-0">
                <span className={`text-[10px] font-mono mt-0.5 w-14 flex-shrink-0 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>{timeStr(entry.timestamp)}</span>

                {entry.type === 'user' && (
                  <>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-300 flex-shrink-0">YOU</span>
                    <p className={`text-sm font-mono ${isDark ? 'text-blue-200' : 'text-blue-700'}`}>{entry.content}</p>
                  </>
                )}

                {entry.type === 'system' && (
                  <p className={`text-xs font-mono italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{entry.content}</p>
                )}

                {entry.type === 'tool_call' && (
                  <>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${isDark ? 'bg-yellow-900/30 text-yellow-300' : 'bg-yellow-100 text-yellow-700'}`}>
                      {locale === 'zh' ? '操作' : 'ACT'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs font-mono ${isDark ? 'text-yellow-200' : 'text-yellow-700'}`}>{entry.content}</span>
                    </div>
                  </>
                )}

                {/* tool_output hidden — only errors are shown */}

                {entry.type === 'suggestions' && entry.meta?.actions && (
                  <div className="flex-1 min-w-0">
                    <div className="grid grid-cols-1 gap-2 mt-1">
                      {(entry.meta.actions as Array<{ id: string; emoji: string; title: string; description: string }>).map((action) => (
                        <button
                          key={action.id}
                          onClick={() => sendMessage(action.title)}
                          disabled={isProcessing}
                          className={`text-left px-3 py-2.5 rounded-lg border transition-all disabled:opacity-50 ${isDark
                            ? 'bg-gray-800/50 hover:bg-gray-700/80 border-gray-700 hover:border-blue-600'
                            : 'bg-white hover:bg-blue-50 border-gray-200 hover:border-blue-300'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="text-lg flex-shrink-0">{action.emoji}</span>
                            <div className="min-w-0">
                              <p className={`text-xs font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{action.title}</p>
                              <p className={`text-[11px] mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{action.description}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {entry.type === 'text' && (
                  <>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>AI</span>
                    <div className="flex-1 min-w-0 overflow-x-auto">
                      <StreamingText content={entry.content} isStreaming={isProcessing && entry.id === activities[activities.length - 1]?.id} />
                    </div>
                  </>
                )}

                {entry.type === 'file_download' && (
                  <>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${isDark ? 'bg-cyan-900/30 text-cyan-300' : 'bg-cyan-100 text-cyan-700'}`}>FILE</span>
                    <span className={`text-xs font-mono ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}>
                      {locale === 'zh' ? '文件已准备就绪 ↓' : 'File ready ↓'}
                    </span>
                  </>
                )}

                {entry.type === 'error' && (
                  <>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${isDark ? 'bg-red-900/30 text-red-300' : 'bg-red-100 text-red-600'}`}>ERR</span>
                    <pre className={`text-xs font-mono overflow-x-auto max-h-24 overflow-y-auto flex-1 p-1 rounded ${isDark ? 'text-red-300/80' : 'text-red-600'}`}>
                      {entry.content.slice(0, 500)}
                    </pre>
                  </>
                )}
              </div>
            ))}

            {isProcessing && (
              <div className={`flex items-center gap-2 text-xs font-mono ${isDark ? 'text-yellow-500' : 'text-yellow-600'}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
                {locale === 'zh' ? 'Agent 处理中...' : 'Agent processing...'}
              </div>
            )}

            {/* File downloads — rendered at the bottom after all activity */}
            {!isProcessing && activities.filter((a) => a.type === 'file_download').length > 0 && (
              <div className={`mt-4 p-3 rounded-lg border ${isDark ? 'bg-gray-900 border-cyan-800/40' : 'bg-cyan-50 border-cyan-200'}`}>
                <p className={`text-xs font-mono mb-2 ${isDark ? 'text-cyan-300' : 'text-cyan-700'}`}>
                  📥 {locale === 'zh' ? '可下载文件' : 'Downloads'}
                </p>
                <div className="space-y-1.5">
                  {activities.filter((a) => a.type === 'file_download').map((entry) => (
                    <a key={entry.id}
                      href={`data:application/octet-stream;base64,${entry.meta?.base64 || ''}`}
                      download={entry.content}
                      className={`flex items-center gap-2 px-3 py-2 rounded border transition-colors ${isDark ? 'bg-cyan-950/30 border-cyan-800/50 hover:bg-cyan-950/60' : 'bg-white border-cyan-200 hover:bg-cyan-50'}`}>
                      <svg className={`w-4 h-4 ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span className={`text-xs font-mono font-medium ${isDark ? 'text-cyan-200' : 'text-cyan-700'}`}>{entry.content}</span>
                      {entry.meta?.description && (
                        <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>— {entry.meta.description.slice(0, 60)}</span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div ref={activityEndRef} />
          </div>

          {/* Input */}
          <div className={`flex-shrink-0 border-t ${isDark ? 'border-gray-800' : 'border-gray-200'} p-3`}>
            <div className="flex gap-2">
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onCompositionStart={() => { isComposingRef.current = true; }}
                onCompositionEnd={() => { isComposingRef.current = false; }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={locale === 'zh' ? '输入指令... (合并 PDF / Excel 转表格 / 分析数据)' : 'Enter command... (merge PDF / Excel to table / analyze)'}
                disabled={isProcessing}
                className={`flex-1 px-3 py-2 text-sm font-mono rounded-lg border focus:outline-none focus:ring-1 disabled:opacity-50 ${isDark ? 'bg-gray-900 border-gray-700 text-gray-100 placeholder-gray-600 focus:ring-blue-600' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-blue-400'}`}
              />
              <button onClick={() => sendMessage()} disabled={!userInput.trim() || isProcessing}
                className={`px-4 py-2 text-sm font-mono rounded-lg transition-colors disabled:opacity-40 ${isDark ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-500 hover:bg-blue-400 text-white'}`}>
                {isProcessing ? '...' : 'Run ▸'}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
