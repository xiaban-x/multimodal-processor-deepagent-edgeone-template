'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';
import type { FileItem } from '../page';

interface FileQueueProps {
  files: FileItem[];
  isProcessing: boolean;
  onProcess: () => void;
  onClear: () => void;
}

const TYPE_ICONS: Record<FileItem['type'], { color: string; label: string }> = {
  pdf: { color: 'bg-red-100 text-red-700', label: 'PDF' },
  image: { color: 'bg-blue-100 text-blue-700', label: 'IMG' },
  csv: { color: 'bg-green-100 text-green-700', label: 'CSV' },
  text: { color: 'bg-gray-100 text-gray-700', label: 'TXT' },
};

export function FileQueue({ files, isProcessing, onProcess, onClear }: FileQueueProps) {
  const { t } = useI18n();

  const STATUS_BADGE: Record<FileItem['status'], { variant: 'default' | 'secondary' | 'success' | 'error'; label: string }> = {
    queued: { variant: 'default', label: t.queued },
    processing: { variant: 'secondary', label: t.processing },
    done: { variant: 'success', label: t.done },
    error: { variant: 'error', label: t.error },
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-800">
          {t.fileQueue} {files.length > 0 && <span className="text-gray-400">({files.length})</span>}
        </h2>
        {files.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear} disabled={isProcessing}>
            {t.clear}
          </Button>
        )}
      </div>

      {files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400 py-8">
          {t.noFilesInQueue}
        </div>
      ) : (
        <ul className="flex-1 space-y-2 overflow-y-auto max-h-48 mb-3">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50">
              <span className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold ${TYPE_ICONS[file.type].color}`}>
                {TYPE_ICONS[file.type].label}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                <p className="text-xs text-gray-500">{file.size}</p>
              </div>
              <Badge variant={STATUS_BADGE[file.status].variant}>
                {file.status === 'processing' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse mr-1.5" />
                )}
                {STATUS_BADGE[file.status].label}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <Button
        onClick={onProcess}
        disabled={files.length === 0 || isProcessing}
        className="w-full"
      >
        {isProcessing ? (
          <>
            <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t.processing}
          </>
        ) : (
          t.processAll
        )}
      </Button>
    </div>
  );
}
