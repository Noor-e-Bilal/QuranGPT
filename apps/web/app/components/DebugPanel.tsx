'use client';

import { useState } from 'react';
import type { DebugInfo, UpgradeDebugInfo } from '@/lib/types';

interface Props {
  debug?: DebugInfo;
  upgradeDebug?: UpgradeDebugInfo;
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

function CurrentTab({ debug }: { debug: DebugInfo }) {
  const { retrieval, llm } = debug;
  return (
    <div className="space-y-3">
      <Section title="📋 Meta">
        <KV k="Timestamp" v={debug.timestamp} />
        <KV k="Clarification Round" v={debug.clarification_round} />
        <KV k="Safety Valve" v={String(debug.safety_valve)} />
        <KV k="Cache Hit" v={String(debug.cache_hit)} />
        {debug.cache_info && (
          <>
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-slate-500 shrink-0 w-36">Cache Strategy</span>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide ${
                  debug.cache_info.strategy === 'exact'
                    ? 'bg-green-900/60 text-green-300'
                    : debug.cache_info.strategy === 'semantic'
                    ? 'bg-sky-900/60 text-sky-300'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                {debug.cache_info.strategy}
              </span>
            </div>
            {debug.cache_info.similarity !== undefined && (
              <KV k="Cache Similarity" v={`${(debug.cache_info.similarity * 100).toFixed(1)}%`} mono />
            )}
            {debug.cache_info.matched_question && (
              <KV k="Matched Question" v={debug.cache_info.matched_question} />
            )}
          </>
        )}
        <KV k="Original Question" v={debug.original_question} />
        {debug.reformulated_query && (
          <KV k="Reformulated Query" v={debug.reformulated_query} />
        )}
        <KV k="Enriched Query" v={debug.enriched_query} />
        {debug.provider_settings && (
          <>
            <KV k="Provider" v={debug.provider_settings.provider} mono />
            <KV k="Model" v={debug.provider_settings.model} mono />
          </>
        )}
      </Section>

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

      <Section title="🤖 LLM">
        <KV k="Prompt Type" v={llm.prompt_type} />
        <KV k="Model" v={llm.model} mono />
        <Collapsible label="Prompt sent to LLM" content={llm.prompt_sent} />
        <Collapsible label="Raw LLM response" content={llm.raw_response} />
      </Section>
    </div>
  );
}

function UpgradeTab({ upgradeDebug }: { upgradeDebug: UpgradeDebugInfo }) {
  const { retrieval, llm } = upgradeDebug;
  return (
    <div className="space-y-3">
      <Section title="🔍 Retrieval (BGE-base + RRF)">
        <KV k="Query Used" v={retrieval.query_used} />
        <KV k="Embedding Model" v={retrieval.embedding_model} mono />
        <KV k="FTS Hits" v={retrieval.fts_hits} />
        <KV k="Semantic Hits" v={retrieval.semantic_hits} />
        <KV k="Confidence" v={retrieval.confidence.toUpperCase()} />

        {retrieval.rrf_scores.length > 0 && (
          <div className="mt-2">
            <p className="text-slate-500 mb-1">Top RRF scores (RRF = Σ 1/(60 + rank_i)):</p>
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="pr-3 py-0.5">Ref</th>
                  <th className="pr-3 py-0.5">FTS rank</th>
                  <th className="pr-3 py-0.5">Sem rank</th>
                  <th className="py-0.5">RRF score</th>
                </tr>
              </thead>
              <tbody>
                {retrieval.rrf_scores.map((s) => (
                  <tr key={s.reference} className="border-t border-slate-800">
                    <td className="pr-3 py-0.5 text-sky-400">{s.reference}</td>
                    <td className="pr-3 py-0.5">{s.rank_fts > 0 ? `#${s.rank_fts}` : '—'}</td>
                    <td className="pr-3 py-0.5">{s.rank_semantic > 0 ? `#${s.rank_semantic}` : '—'}</td>
                    <td
                      className={`py-0.5 font-bold ${
                        s.rrf_score >= 0.025
                          ? 'text-green-400'
                          : s.rrf_score >= 0.015
                          ? 'text-yellow-400'
                          : 'text-red-400'
                      }`}
                    >
                      {s.rrf_score.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="🤖 LLM">
        <KV k="Prompt Type" v={llm.prompt_type} />
        <KV k="Model" v={llm.model} mono />
        <Collapsible label="Prompt sent to LLM" content={llm.prompt_sent} />
        <Collapsible label="Raw LLM response" content={llm.raw_response} />
      </Section>
    </div>
  );
}

export default function DebugPanel({ debug, upgradeDebug, onClose }: Props) {
  const hasCurrent = !!debug;
  const hasUpgrade = !!upgradeDebug;
  const hasTabs = hasCurrent && hasUpgrade;
  const [tab, setTab] = useState<'current' | 'upgrade'>(hasCurrent ? 'current' : 'upgrade');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
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

        {/* Tabs (only shown in comparison mode) */}
        {hasTabs && (
          <div className="flex border-b border-slate-700 shrink-0">
            <button
              onClick={() => setTab('current')}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                tab === 'current'
                  ? 'text-emerald-400 border-b-2 border-emerald-500 bg-emerald-900/10'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              ← Current Pipeline
            </button>
            <button
              onClick={() => setTab('upgrade')}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                tab === 'upgrade'
                  ? 'text-sky-400 border-b-2 border-sky-500 bg-sky-900/10'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Upgrade Pipeline →
            </button>
          </div>
        )}

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-4">
          {hasCurrent && (!hasTabs || tab === 'current') && <CurrentTab debug={debug!} />}
          {hasUpgrade && (!hasTabs || tab === 'upgrade') && <UpgradeTab upgradeDebug={upgradeDebug!} />}
        </div>
      </div>
    </div>
  );
}
