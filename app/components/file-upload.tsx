'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';
import type { FileItem } from '../page';

interface FileUploadProps {
  onFilesAdded: (files: FileItem[]) => void;
  disabled?: boolean;
}

const SAMPLE_FILES: FileItem[] = [
  { id: 'sample-1', name: 'quarterly-report.pdf', type: 'pdf', size: '2.4 MB', status: 'queued' },
  { id: 'sample-2', name: 'product-photo.png', type: 'image', size: '1.8 MB', status: 'queued' },
  { id: 'sample-3', name: 'sales-data.csv', type: 'csv', size: '450 KB', status: 'queued' },
  { id: 'sample-4', name: 'meeting-notes.txt', type: 'text', size: '12 KB', status: 'queued' },
];

function getFileType(name: string): FileItem['type'] {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  if (['csv', 'xls', 'xlsx'].includes(ext)) return 'csv';
  return 'text';
}

export function FileUpload({ onFilesAdded, disabled }: FileUploadProps) {
  const { t } = useI18n();
  const [isDragOver, setIsDragOver] = useState(false);
  const [textInput, setTextInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (disabled) return;

      const droppedFiles = Array.from(e.dataTransfer.files);
      const fileItems: FileItem[] = droppedFiles.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        type: getFileType(f.name),
        size: f.size > 1024 * 1024 ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` : `${(f.size / 1024).toFixed(0)} KB`,
        status: 'queued',
      }));
      onFilesAdded(fileItems);
    },
    [onFilesAdded, disabled]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const selectedFiles = Array.from(e.target.files || []);
      const fileItems: FileItem[] = selectedFiles.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        type: getFileType(f.name),
        size: f.size > 1024 * 1024 ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` : `${(f.size / 1024).toFixed(0)} KB`,
        status: 'queued',
      }));
      onFilesAdded(fileItems);
      if (inputRef.current) inputRef.current.value = '';
    },
    [onFilesAdded, disabled]
  );

  const handleTextSubmit = useCallback(() => {
    if (!textInput.trim() || disabled) return;
    const lines = textInput.split('\n').filter((l) => l.trim());
    const fileItems: FileItem[] = lines.map((line) => {
      const name = line.trim();
      return {
        id: crypto.randomUUID(),
        name,
        type: getFileType(name),
        size: 'N/A',
        status: 'queued' as const,
      };
    });
    onFilesAdded(fileItems);
    setTextInput('');
  }, [textInput, onFilesAdded, disabled]);

  const handleSampleFiles = useCallback(() => {
    if (disabled) return;
    const samples = SAMPLE_FILES.map((f) => ({ ...f, id: crypto.randomUUID() }));
    onFilesAdded(samples);
  }, [onFilesAdded, disabled]);

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all
          ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept=".pdf,.png,.jpg,.jpeg,.csv,.xls,.xlsx,.txt,.md"
        />

        <svg className="w-12 h-12 text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>

        <p className="text-sm font-medium text-gray-700">{t.dropHere}</p>
        <p className="text-xs text-gray-500 mt-1">{t.orDescribeBelow}</p>

        <div className="flex gap-2 mt-3">
          <Badge variant="error">PDF</Badge>
          <Badge variant="secondary">PNG/JPG</Badge>
          <Badge variant="success">CSV</Badge>
          <Badge variant="default">TXT</Badge>
        </div>
      </div>

      {/* Text input for file descriptions */}
      <div className="flex gap-2">
        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()}
          placeholder={t.typePlaceholder}
          disabled={disabled}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <Button size="sm" onClick={handleTextSubmit} disabled={disabled || !textInput.trim()}>
          {t.add}
        </Button>
      </div>

      {/* Quick demo */}
      <Button variant="outline" size="sm" onClick={handleSampleFiles} disabled={disabled} className="w-full">
        {t.processSampleFiles}
      </Button>
    </div>
  );
}
