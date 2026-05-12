'use client';

import { useState } from 'react';
import type { DebugInfo } from '@/lib/types';

interface Props {
  debug: DebugInfo;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <div className="bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
        {title}
      </div>
      <div className="px-3 py-3 text-xs text-slate-300 space-y-1.5">{children}</div>
    </div>
  );
}

function KV({ k, v, mono = false }: { k: string; v: string | number | boolean; mono?: boolean }) {
  return (
    <div className="flex gap-2 flex-wrap">
      <span className="text-slate-500 shrink-0 w-36">{k}</span>
      <span className={`text-slate-200 break-all ${mono ? 'font-mono' : ''}`}>
        {String(v)}
      </span>
    </div>
  );
}

function Collapsible({ label, content }: { label: string; content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 text-xs font-medium py-0.5"
      >
        <span>{open ? '▾' : '▸'}</span> {label}
      </button>
      {open && (
        <pre className="mt-1 bg-slate-950 rounded p-2 text-[11px] font-mono text-slate-300 overflow-auto max-h-64 whitespace-pre-wrap break-words">
          {content}
        </pre>
      )}
    </div>
  );
}

export default function DebugPanel({ debug, onClose }: Props) {
  const { retrieval, llm } = debug;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
          <span className="text-sm font-semibold text-slate-200">🔬 Debug Panel</span>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg leading-none"
            aria-label="Close debug panel"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {/* Meta */}
          <Section title="📋 Meta">
            <KV k="Timestamp" v={debug.timestamp} />
            <KV k="Clarification Round" v={debug.clarification_round} />
            <KV k="Safety Valve" v={String(debug.safety_valve)} />
            <KV k="Cache Hit" v={String(debug.cache_hit)} />
            <KV k="Original Question" v={debug.original_question} />
            <KV k="Enriched Query" v={debug.enriched_query} />
          </Section>

          {/* Retrieval */}
          <Section title="🔍 Retrieval">
            <KV k="Query Used" v={retrieval.query_used} />
            <KV k="Expanded Query" v={retrieval.expanded_query} />
            <KV k="Embedding Model" v={retrieval.embedding_model} mono />
            <KV k="FTS Hits" v={retrieval.fts_hits} />
            <KV k="Semantic Hits" v={retrieval.semantic_hits} />
            <KV k="Confidence" v={retrieval.confidence.toUpperCase()} />

            {retrieval.scores.length > 0 && (
              <div className="mt-2">
                <p className="text-slate-500 mb-1">Top scores (FTS×0.4 + Semantic×0.6):</p>
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-slate-500 text-left">
                      <th className="pr-3 py-0.5">Ref</th>
                      <th className="pr-3 py-0.5">FTS</th>
                      <th className="pr-3 py-0.5">Semantic</th>
                      <th className="py-0.5">Combined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retrieval.scores.map((s) => (
                      <tr key={s.reference} className="border-t border-slate-800">
                        <td className="pr-3 py-0.5 text-emerald-400">{s.reference}</td>
                        <td className="pr-3 py-0.5">{s.fts_score.toFixed(3)}</td>
                        <td className="pr-3 py-0.5">{s.semantic_score.toFixed(3)}</td>
                        <td
                          className={`py-0.5 font-bold ${
                            s.combined_score >= 0.5
                              ? 'text-green-400'
                              : s.combined_score >= 0.3
                              ? 'text-yellow-400'
                              : 'text-red-400'
                          }`}
                        >
                          {s.combined_score.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* LLM */}
          <Section title="🤖 LLM">
            <KV k="Prompt Type" v={llm.prompt_type} />
            <KV k="Model" v={llm.model} mono />
            <Collapsible label="Prompt sent to LLM" content={llm.prompt_sent} />
            <Collapsible label="Raw LLM response" content={llm.raw_response} />
          </Section>
        </div>
      </div>
    </div>
  );
}
