'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

type Locale = 'zh' | 'en';

export const translations = {
  zh: {
    title: '多模态文件处理',
    description: 'AI 驱动的文件分析与专业子代理',
    dropFiles: '拖放文件或点击上传',
    process: '处理',
    clear: '清除',
    summary: '摘要',
    processing: '处理中...',
    processingResults: '处理结果',
    processingLog: '处理日志',
    fileQueue: '文件队列',
    dropHere: '拖放文件到此处或点击浏览',
    orDescribeBelow: '或在下方描述文件',
    typePlaceholder: '输入文件名（如 report.pdf）然后按回车',
    add: '添加',
    processSampleFiles: '处理示例文件',
    noFilesInQueue: '队列中没有文件。添加文件以开始。',
    processAll: '处理全部',
    showLess: '收起',
    viewFull: '查看全部',
    noContent: '无可用内容。',
    crossFileSummary: '跨文件摘要',
    queued: '排队中',
    done: '完成',
    error: '错误',
  },
  en: {
    title: 'Multimodal File Processor',
    description: 'AI-powered file analysis with specialized SubAgents',
    dropFiles: 'Drop files or click to upload',
    process: 'Process',
    clear: 'Clear',
    summary: 'Summary',
    processing: 'Processing...',
    processingResults: 'Processing Results',
    processingLog: 'Processing Log',
    fileQueue: 'File Queue',
    dropHere: 'Drop files here or click to browse',
    orDescribeBelow: 'Or describe files below',
    typePlaceholder: 'Type filename (e.g., report.pdf) and press Enter',
    add: 'Add',
    processSampleFiles: 'Process sample files',
    noFilesInQueue: 'No files in queue. Add files to get started.',
    processAll: 'Process All',
    showLess: 'Show Less',
    viewFull: 'View Full',
    noContent: 'No content available.',
    crossFileSummary: 'Cross-File Summary',
    queued: 'Queued',
    done: 'Done',
    error: 'Error',
  },
};

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: typeof translations.zh;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'zh',
  setLocale: () => {},
  t: translations.zh,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('zh');
  const t = translations[locale];
  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
