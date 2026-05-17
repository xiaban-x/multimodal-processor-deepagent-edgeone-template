'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import type { FileItem } from '../page';

interface FileResultProps {
  file: FileItem;
}

const TYPE_BADGE: Record<FileItem['type'], { variant: 'error' | 'secondary' | 'success' | 'default'; label: string }> = {
  pdf: { variant: 'error', label: 'PDF' },
  image: { variant: 'secondary', label: 'Image' },
  csv: { variant: 'success', label: 'CSV' },
  text: { variant: 'default', label: 'Text' },
};

export function FileResult({ file }: FileResultProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const content = file.result || t.noContent;
  const preview = content.slice(0, 300);
  const hasMore = content.length > 300;

  return (
    <article>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{file.name}</h3>
            <Badge variant={TYPE_BADGE[file.type].variant}>{TYPE_BADGE[file.type].label}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none text-gray-700">
            <ReactMarkdown>{expanded ? content : preview + (hasMore && !expanded ? '...' : '')}</ReactMarkdown>
          </div>
        </CardContent>
        {hasMore && (
          <CardFooter>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? t.showLess : t.viewFull}
            </Button>
          </CardFooter>
        )}
      </Card>
    </article>
  );
}
