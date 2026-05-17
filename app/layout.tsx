import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Multimodal File Processor',
  description: 'AI-powered file processing workbench with specialized SubAgents',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
