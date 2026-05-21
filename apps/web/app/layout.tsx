import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QuranSays',
  description: 'Ask any question — answered from The Clear Quran',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen flex flex-col bg-emerald-950 text-slate-100 antialiased overflow-hidden">
        <header className="shrink-0 border-b border-emerald-800 px-4 py-3 flex items-center gap-3">
          <a href="/chat" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <span className="text-2xl">📖</span>
            <span className="font-semibold text-emerald-300 text-lg tracking-wide">
              QuranSays
            </span>
          </a>
          <span className="text-xs text-slate-400 ml-2">
            — answers grounded in The Clear Quran
          </span>
        </header>
        <div className="flex-1 overflow-hidden">{children}</div>
      </body>
    </html>
  );
}
