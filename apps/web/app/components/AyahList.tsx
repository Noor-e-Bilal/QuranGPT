'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AyahRow } from '@/lib/types';

interface Props {
  ayahs: AyahRow[];
  chapter: number;
}

const PAGE_SIZE = 30;

export default function AyahList({ ayahs, chapter }: Props) {
  const totalPages = Math.max(1, Math.ceil(ayahs.length / PAGE_SIZE));
  const [page, setPage] = useState(1);

  const visible = ayahs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      {/* Ayah list */}
      <ol className="flex flex-col gap-3">
        {visible.map((a) => (
          <li key={a.ayah}>
            <Link
              href={`/${chapter}/${a.ayah}`}
              className="flex items-start gap-4 bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3 hover:border-emerald-600 transition-colors group"
            >
              <span className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-emerald-800 text-emerald-100 text-xs font-bold group-hover:bg-emerald-600 transition-colors">
                {a.ayah}
              </span>
              <div className="flex flex-col gap-2 min-w-0 flex-1">
                {a.arabic_text && (
                  <p
                    dir="rtl"
                    lang="ar"
                    className="text-2xl sm:text-3xl leading-relaxed text-slate-100 text-right"
                    style={{ fontFamily: "'KFGQPCUthmanicScriptHAFS', serif" }}
                  >
                    {a.arabic_text}
                  </p>
                )}
                <p className="text-xs text-slate-400">{a.display_text}</p>
              </div>
            </Link>
          </li>
        ))}
      </ol>

      {/* Pagination — only shown when there are multiple pages */}
      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:border-emerald-600 text-sm text-slate-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-slate-700"
          >
            ← Prev
          </button>
          <span className="text-sm text-slate-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:border-emerald-600 text-sm text-slate-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-slate-700"
          >
            Next →
          </button>
        </nav>
      )}
    </>
  );
}
