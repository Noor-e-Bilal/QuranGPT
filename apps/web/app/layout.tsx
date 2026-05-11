import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QuranSays',
  description: 'Ask any question — answered from The Clear Quran',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-emerald-950 text-slate-100 antialiased">
        <header className="border-b border-emerald-800 px-4 py-3 flex items-center gap-3">
          <span className="text-2xl">📖</span>
          <span className="font-semibold text-emerald-300 text-lg tracking-wide">
            QuranSays
          </span>
          <span className="text-xs text-slate-400 ml-2">
            — answers grounded in The Clear Quran
          </span>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
