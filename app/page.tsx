'use client';

import { useState, useCallback } from 'react';
import { FileUpload } from './components/file-upload';
import { FileQueue } from './components/file-queue';
import { FileResult } from './components/file-result';
import { SummaryPanel } from './components/summary-panel';
import { ProcessingLog } from './components/processing-log';
import { LanguageToggle } from '@/components/ui/language-toggle';
import { TokenUsage } from '@/components/ui/token-usage';
import { useI18n } from '@/lib/i18n';

export interface FileItem {
  id: string;
  name: string;
  type: 'pdf' | 'image' | 'csv' | 'text';
  size: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  result?: string;
  processingTime?: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  agent: string;
  status: 'pending' | 'running' | 'complete';
  description?: string;
  content?: string;
}

/**
 * Parse the AI response and split into per-file results.
 * The model typically outputs markdown with headers like "## File: quarterly-report.pdf"
 * or "**quarterly-report.pdf**" etc. We try to match file names to split the content.
 */
function distributeResults(fullContent: string, files: FileItem[]): Map<string, string> {
  const results = new Map<string, string>();

  if (!fullContent.trim()) return results;

  // Try to split by file name patterns in markdown headings
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = file.name;
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Look for the file name in the content (various heading formats)
    const pattern = new RegExp(
      `(?:^|\\n)(?:#{1,4}\\s*(?:\\d+\\.?\\s*)?|\\*\\*)?.*?${escapedName}.*?(?:\\*\\*)?\\s*\\n`,
      'i'
    );
    const match = fullContent.match(pattern);

    if (match && match.index !== undefined) {
      const startIdx = match.index;
      // Find where the next file section starts
      let endIdx = fullContent.length;
      for (let j = 0; j < files.length; j++) {
        if (j === i) continue;
        const nextName = files[j].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nextPattern = new RegExp(
          `(?:^|\\n)(?:#{1,4}\\s*(?:\\d+\\.?\\s*)?|\\*\\*)?.*?${nextName}.*?(?:\\*\\*)?\\s*\\n`,
          'i'
        );
        const nextMatch = fullContent.slice(startIdx + match[0].length).match(nextPattern);
        if (nextMatch && nextMatch.index !== undefined) {
          const possibleEnd = startIdx + match[0].length + nextMatch.index;
          if (possibleEnd < endIdx && possibleEnd > startIdx) {
            endIdx = possibleEnd;
          }
        }
      }
      results.set(name, fullContent.slice(startIdx, endIdx).trim());
    }
  }

  // If we couldn't split, give each file the full content
  if (results.size === 0) {
    for (const file of files) {
      results.set(file.name, fullContent);
    }
  }

  return results;
}

export default function Home() {
  const { t, locale } = useI18n();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [conversationId] = useState(() => crypto.randomUUID());
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0 });

  const addFiles = useCallback((newFiles: FileItem[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const processFiles = useCallback(async () => {
    if (files.length === 0 || isProcessing) return;

    setIsProcessing(true);
    setLogs([]);
    setSummary('');
    setTokenUsage({ input: 0, output: 0 });

    // Mark all as processing
    setFiles((prev) => prev.map((f) => ({ ...f, status: 'processing' as const })));

    const fileDescriptions = files
      .map((f) => `- ${f.name} (${f.type}, ${f.size})`)
      .join('\n');

    const message = locale === 'zh'
      ? `请处理以下文件：\n${fileDescriptions}\n\n请对每个文件根据其类型进行分析，用中文给出详细的结构化处理结果。`
      : `Process the following files:\n${fileDescriptions}\n\nFor each file, analyze its content based on its type and provide detailed structured results.`;

    try {
      const response = await fetch('/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          conversationId,
          locale,
          fileNames: files.map((f) => f.name),
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

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

            switch (event.type) {
              case 'ping':
                break;

              case 'usage':
                setTokenUsage({ input: event.input_tokens || 0, output: event.output_tokens || 0 });
                break;

              case 'subagent_lifecycle': {
                const logId = `${event.id}-${event.status}-${Date.now()}`;
                const logEntry: LogEntry = {
                  id: logId,
                  timestamp: Date.now(),
                  agent: event.agent || 'unknown',
                  status: event.status,
                  description: event.status === 'pending'
                    ? (locale === 'zh' ? '等待处理...' : 'Waiting...')
                    : event.status === 'running'
                    ? (locale === 'zh' ? '正在分析...' : 'Analyzing...')
                    : (locale === 'zh' ? '处理完成' : 'Done'),
                };
                setLogs((prev) => {
                  // Update existing entry for this file if status changed
                  const existing = prev.findIndex((l) => l.agent === event.agent && l.status !== 'complete');
                  if (existing >= 0 && event.status !== 'pending') {
                    const updated = [...prev];
                    updated[existing] = logEntry;
                    return updated;
                  }
                  return [...prev, logEntry];
                });
                break;
              }

              case 'ai_response': {
                if (event.content) {
                  fullContent += event.content;
                }
                break;
              }

              case 'error_message':
                setFiles((prev) =>
                  prev.map((f) =>
                    f.status === 'processing' ? { ...f, status: 'error' } : f
                  )
                );
                break;
            }
          } catch {
            // skip malformed JSON
          }
        }
      }

      // Parse the full response and assign results to files
      // The model outputs markdown with sections per file — distribute to each file
      const fileResults = distributeResults(fullContent, files);

      setFiles((prev) =>
        prev.map((f) => {
          if (f.status === 'processing') {
            const result = fileResults.get(f.name) || fileResults.get(f.id) || fullContent;
            return { ...f, status: 'done', result, processingTime: Date.now() };
          }
          return f;
        })
      );

      // Generate summary if we have content
      if (fullContent.trim()) {
        const resultsArray = files.map((f) => ({
          filename: f.name,
          type: f.type,
          content: fileResults.get(f.name) || fullContent,
        }));

        try {
          const sumResp = await fetch('/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ results: resultsArray, locale }),
          });
          if (sumResp.ok) {
            const { summary: summaryText } = await sumResp.json();
            setSummary(summaryText);
          }
        } catch {
          // Summary is optional
        }
      }
    } catch (error) {
      setFiles((prev) =>
        prev.map((f) => (f.status === 'processing' ? { ...f, status: 'error' } : f))
      );
    } finally {
      setIsProcessing(false);
    }
  }, [files, isProcessing, conversationId, locale]);

  const clearAll = useCallback(() => {
    setFiles([]);
    setLogs([]);
    setSummary('');
    setTokenUsage({ input: 0, output: 0 });
  }, []);

  return (
    <main className="min-h-screen p-6 max-w-7xl mx-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-500 mt-1">{t.description}</p>
        </div>
        <LanguageToggle />
      </header>

      {/* Top row: Upload + Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <FileUpload onFilesAdded={addFiles} disabled={isProcessing} />
        <FileQueue
          files={files}
          isProcessing={isProcessing}
          onProcess={processFiles}
          onClear={clearAll}
        />
      </div>

      {/* Processing log */}
      <ProcessingLog logs={logs} />

      {/* Results */}
      {files.some((f) => f.status === 'done') && (
        <section className="mt-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">{t.processingResults}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {files
              .filter((f) => f.status === 'done')
              .map((f) => (
                <FileResult key={f.id} file={f} />
              ))}
          </div>
        </section>
      )}

      {/* Summary */}
      {summary && <SummaryPanel summary={summary} />}

      {/* Token Usage */}
      {(tokenUsage.input > 0 || tokenUsage.output > 0) && (
        <div className="mt-4">
          <TokenUsage inputTokens={tokenUsage.input} outputTokens={tokenUsage.output} />
        </div>
      )}
    </main>
  );
}
