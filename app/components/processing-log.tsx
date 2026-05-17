'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';
import type { LogEntry } from '../page';

interface ProcessingLogProps {
  logs: LogEntry[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-400',
  running: 'bg-blue-500 animate-pulse',
  complete: 'bg-green-500',
};

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'success'> = {
  pending: 'default',
  running: 'secondary',
  complete: 'success',
};

export function ProcessingLog({ logs }: ProcessingLogProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(true);

  if (logs.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="text-sm font-medium text-gray-700">{t.processingLog}</span>
          <Badge variant="default">{logs.length}</Badge>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-100 px-4 py-3 max-h-64 overflow-y-auto space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="flex items-start gap-3 text-sm">
              <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[log.status]}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">{log.agent}</span>
                  <Badge variant={STATUS_BADGE_VARIANT[log.status]}>
                    {log.status.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-gray-400">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {log.description && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{log.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
