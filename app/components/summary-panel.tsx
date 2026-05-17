'use client';

import ReactMarkdown from 'react-markdown';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { useI18n } from '@/lib/i18n';

interface SummaryPanelProps {
  summary: string;
}

export function SummaryPanel({ summary }: SummaryPanelProps) {
  const { t } = useI18n();

  return (
    <section className="mt-6">
      <Card className="border-purple-200 bg-purple-50/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h2 className="text-lg font-semibold text-purple-900">{t.crossFileSummary}</h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm prose-purple max-w-none">
            <ReactMarkdown>{summary}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
