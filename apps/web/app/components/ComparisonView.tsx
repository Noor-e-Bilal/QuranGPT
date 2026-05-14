'use client';

import type { ChatResponse, ComparePanelResult, RetrievalConfidence } from '@/lib/types';

// ── Shared sub-components ────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: RetrievalConfidence }) {
  const cls =
    confidence === 'high'
      ? 'bg-green-700/50 text-green-300'
      : confidence === 'medium'
      ? 'bg-yellow-700/50 text-yellow-300'
      : 'bg-red-700/50 text-red-300';
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {confidence}
    </span>
  );
}

interface PanelData {
  label: string;
  formula: string;
  answer: string;
  citations: ChatResponse['citations'];
  limitations: string | null;
  confidence: RetrievalConfidence;
  source_policy: string;
  reformulated_query?: string;
}

function AnswerPanel({
  data,
  accent,
  loading,
  error,
  onDebug,
}: {
  data?: PanelData;
  accent: 'emerald' | 'sky';
  loading?: boolean;
  error?: string;
  onDebug?: () => void;
}) {
  const headerBorder = accent === 'emerald' ? 'border-emerald-700/40' : 'border-sky-700/40';
  const headerBg = accent === 'emerald' ? 'bg-emerald-900/20' : 'bg-sky-900/20';
  const labelColor = accent === 'emerald' ? 'text-emerald-400' : 'text-sky-400';
  const citationBorder = accent === 'emerald' ? 'border-emerald-800/50' : 'border-sky-800/50';
  const citationBg = accent === 'emerald' ? 'bg-emerald-900/20' : 'bg-sky-900/20';
  const citationRefColor = accent === 'emerald' ? 'text-emerald-400' : 'text-sky-400';

  return (
    <div className="flex-1 min-w-0 flex flex-col rounded-xl border border-slate-700 overflow-hidden bg-slate-800/60">
      {/* Panel header */}
      <div className={`px-4 py-2.5 border-b ${headerBorder} ${headerBg} flex items-center gap-2.5`}>
        <span className={`text-sm font-semibold ${labelColor}`}>
          {data?.label ?? (accent === 'emerald' ? 'Current' : 'Upgrade')}
        </span>
        {data?.formula && (
          <span className="text-[10px] font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
            {data.formula}
          </span>
        )}
        {onDebug && (
          <button
            onClick={onDebug}
            title="Open debug panel"
            className="ml-auto text-[11px] text-slate-500 hover:text-emerald-400 transition-colors"
            aria-label="Debug info"
          >
            🔬
          </button>
        )}
      </div>

      <div className="p-4 flex flex-col gap-3 flex-1">
        {loading ? (
          // Skeleton while right panel is loading
          <div className="flex flex-col gap-3 animate-pulse">
            <div className="h-3 bg-slate-700 rounded w-3/4" />
            <div className="h-3 bg-slate-700 rounded w-full" />
            <div className="h-3 bg-slate-700 rounded w-5/6" />
            <div className="h-3 bg-slate-700 rounded w-2/3" />
            <div className="mt-2 h-16 bg-slate-700/60 rounded-lg" />
            <div className="mt-1 flex gap-2">
              <div className="h-5 w-12 bg-slate-700 rounded-full" />
              <div className="h-5 w-32 bg-slate-700 rounded" />
            </div>
            <p className="text-[11px] text-slate-500 text-center mt-2">
              Running upgrade pipeline…
            </p>
          </div>
        ) : error ? (
          <p className="text-sm text-red-400 text-center py-4">⚠ {error}</p>
        ) : data ? (
          <>
            {/* Searched for */}
            {data.reformulated_query && (
              <p className="text-[11px] text-slate-500 italic">
                🔍 &ldquo;{data.reformulated_query}&rdquo;
              </p>
            )}

            {/* Answer */}
            <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">
              {data.answer}
            </p>

            {/* Citations */}
            {data.citations.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {data.citations.map((c) => (
                  <a
                    key={`${c.surah}:${c.ayah}`}
                    href={`/${c.surah}/${c.ayah}`}
                    className={`block rounded-lg border ${citationBorder} ${citationBg} px-3 py-2 hover:brightness-110 transition-all`}
                  >
                    <span className={`text-xs font-mono font-semibold ${citationRefColor}`}>
                      {c.reference}
                    </span>
                    <p className="text-xs text-slate-300 mt-0.5 italic">&ldquo;{c.quote}&rdquo;</p>
                  </a>
                ))}
              </div>
            )}

            {/* Footer badges */}
            <div className="flex items-center gap-2 flex-wrap mt-auto pt-1">
              <ConfidenceBadge confidence={data.confidence} />
              <span className="text-[10px] text-slate-500">{data.source_policy}</span>
              {data.limitations && (
                <span className="text-[10px] text-amber-400 w-full">⚠ {data.limitations}</span>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500 text-center py-4">No data available.</p>
        )}
      </div>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

interface Props {
  /** Left panel — current pipeline (from /api/chat) */
  left: ChatResponse;
  leftReformulatedQuery?: string;
  /** Right panel — upgrade pipeline (from /api/compare), null while loading */
  right: ComparePanelResult | null;
  rightLoading: boolean;
  rightError?: string;
  /** Called when the 🔬 debug icon is clicked on either panel. */
  onDebug?: () => void;
}

export default function ComparisonView({ left, leftReformulatedQuery, right, rightLoading, rightError, onDebug }: Props) {
  const leftData: PanelData = {
    label: 'Current',
    formula: 'BGE-small · FTS×0.4 + Sem×0.6',
    answer: left.answer,
    citations: left.citations,
    limitations: left.limitations,
    confidence: left.confidence,
    source_policy: left.source_policy,
    reformulated_query: leftReformulatedQuery ?? left.reformulated_query,
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Column headers */}
      <div className="flex gap-3">
        <div className="flex-1 text-center text-[10px] uppercase tracking-wider text-slate-500">
          ← Current Pipeline
        </div>
        <div className="flex-1 text-center text-[10px] uppercase tracking-wider text-slate-500">
          Upgrade Pipeline →
        </div>
      </div>

      {/* Side-by-side panels */}
      <div className="flex gap-3 items-start">
        <AnswerPanel data={leftData} accent="emerald" onDebug={onDebug} />
        <AnswerPanel
          data={right ?? undefined}
          accent="sky"
          loading={rightLoading}
          error={rightError}
          onDebug={onDebug}
        />
      </div>
    </div>
  );
}
