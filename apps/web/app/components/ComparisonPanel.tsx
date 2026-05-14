'use client';

import { useState } from 'react';
import type { ComparisonBundle, RetrievalDebugScore, RRFScoreRow } from '@/lib/types';

interface Props {
  comparison: ComparisonBundle;
  onClose: () => void;
}

function isRRFRow(s: RetrievalDebugScore | RRFScoreRow): s is RRFScoreRow {
  return 'rrf_score' in s;
}

function PipelineTable({
  scores,
}: {
  scores: (RetrievalDebugScore | RRFScoreRow)[];
}) {
  if (scores.length === 0) {
    return <p className="text-slate-500 text-[11px]">No results.</p>;
  }

  const isRRF = isRRFRow(scores[0]);

  return (
    <table className="w-full text-[11px] font-mono">
      <thead>
        <tr className="text-slate-500 text-left">
          <th className="pr-2 py-0.5 w-16">Ref</th>
          {isRRF ? (
            <>
              <th className="pr-2 py-0.5">FTS rank</th>
              <th className="pr-2 py-0.5">Sem rank</th>
              <th className="py-0.5">RRF score</th>
            </>
          ) : (
            <>
              <th className="pr-2 py-0.5">FTS</th>
              <th className="pr-2 py-0.5">Sem</th>
              <th className="py-0.5">Combined</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {scores.slice(0, 8).map((s) => {
          if (isRRFRow(s)) {
            return (
              <tr key={s.reference} className="border-t border-slate-800">
                <td className="pr-2 py-0.5 text-emerald-400">{s.reference}</td>
                <td className="pr-2 py-0.5">{s.rank_fts > 0 ? `#${s.rank_fts}` : '—'}</td>
                <td className="pr-2 py-0.5">{s.rank_semantic > 0 ? `#${s.rank_semantic}` : '—'}</td>
                <td className="py-0.5 font-bold text-sky-400">{s.rrf_score.toFixed(5)}</td>
              </tr>
            );
          }
          const ls = s as RetrievalDebugScore;
          return (
            <tr key={ls.reference} className="border-t border-slate-800">
              <td className="pr-2 py-0.5 text-emerald-400">{ls.reference}</td>
              <td className="pr-2 py-0.5">{ls.fts_score.toFixed(3)}</td>
              <td className="pr-2 py-0.5">{ls.semantic_score.toFixed(3)}</td>
              <td
                className={`py-0.5 font-bold ${
                  ls.combined_score >= 0.5
                    ? 'text-green-400'
                    : ls.combined_score >= 0.3
                    ? 'text-yellow-400'
                    : 'text-red-400'
                }`}
              >
                {ls.combined_score.toFixed(3)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ConfidenceBadge({ c }: { c: string }) {
  const cls =
    c === 'high'
      ? 'bg-green-700/50 text-green-300'
      : c === 'medium'
      ? 'bg-yellow-700/50 text-yellow-300'
      : 'bg-red-700/50 text-red-300';
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {c}
    </span>
  );
}

function PipelineCard({
  label,
  formula,
  confidence,
  scores,
}: {
  label: string;
  formula: string;
  confidence: string;
  scores: (RetrievalDebugScore | RRFScoreRow)[];
}) {
  return (
    <div className="flex-1 min-w-0 border border-slate-700 rounded-lg overflow-hidden">
      <div className="bg-slate-800 px-3 py-2 space-y-1">
        <p className="text-[11px] font-semibold text-slate-200">{label}</p>
        <p className="text-[10px] font-mono text-slate-400">{formula}</p>
        <ConfidenceBadge c={confidence} />
      </div>
      <div className="px-3 py-2 overflow-x-auto">
        <PipelineTable scores={scores} />
      </div>
    </div>
  );
}

export default function ComparisonPanel({ comparison, onClose }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2 border border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-800 hover:bg-slate-750 text-xs text-slate-300 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <span>⚖️</span>
          <span className="font-medium">Pipeline Comparison</span>
          <span className="text-slate-500">· query: &ldquo;{comparison.query.slice(0, 50)}{comparison.query.length > 50 ? '…' : ''}&rdquo;</span>
        </span>
        <span className="text-slate-500">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="p-3 space-y-3 bg-slate-900">
          {/* Side-by-side pipelines */}
          <div className="flex gap-3 flex-col sm:flex-row">
            <PipelineCard
              label={comparison.current.label}
              formula={comparison.current.formula}
              confidence={comparison.current.confidence}
              scores={comparison.current.scores}
            />
            <PipelineCard
              label={comparison.candidate.label}
              formula={comparison.candidate.formula}
              confidence={comparison.candidate.confidence}
              scores={comparison.candidate.scores}
            />
          </div>

          {/* Top results text diff */}
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <p className="text-slate-500 mb-1 font-medium">Current top refs</p>
              {comparison.current.ayahs.slice(0, 5).map((a) => (
                <p key={a.reference} className="text-emerald-400 font-mono">{a.reference}</p>
              ))}
            </div>
            <div>
              <p className="text-slate-500 mb-1 font-medium">Proposed top refs</p>
              {comparison.candidate.ayahs.slice(0, 5).map((a) => (
                <p key={a.reference} className="text-sky-400 font-mono">{a.reference}</p>
              ))}
            </div>
          </div>

          {/* Upgrade note */}
          <p className="text-[10px] text-amber-400/80 bg-amber-900/20 border border-amber-800/40 rounded px-2 py-1.5">
            ℹ️ {comparison.note}
          </p>

          <button
            onClick={onClose}
            className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
          >
            Close comparison
          </button>
        </div>
      )}
    </div>
  );
}
