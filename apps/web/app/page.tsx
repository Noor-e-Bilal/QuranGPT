'use client';

import { useState, useRef, useEffect } from 'react';
import type { ChatResponse, ApiError, ProviderSettings } from '@/lib/types';
import { PROVIDER_MODELS, DEFAULT_PROVIDER_SETTINGS } from '@/lib/types';
import DebugPanel from './components/DebugPanel';
import ComparisonPanel from './components/ComparisonPanel';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  data?: ChatResponse;
  isClarification?: boolean;
}

type LoadingPhase = 'idle' | 'thinking' | 'searching' | 'generating';

const PHASE_LABELS: Record<Exclude<LoadingPhase, 'idle'>, string> = {
  thinking: 'Thinking…',
  searching: 'Searching The Clear Quran…',
  generating: 'Composing answer…',
};

const WORD_LIMIT = 30;

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('idle');
  const [reformulatedDisplay, setReformulatedDisplay] = useState<string | null>(null);
  const [debugMsgId, setDebugMsgId] = useState<string | null>(null);
  const [compareMsgId, setCompareMsgId] = useState<string | null>(null);
  const [pendingClarification, setPendingClarification] = useState<{ originalQuestion: string } | null>(null);

  // Provider settings state
  const [showSettings, setShowSettings] = useState(false);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(DEFAULT_PROVIDER_SETTINGS);
  const [compareMode, setCompareMode] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loadingPhase]);

  // When provider changes, default to its first model
  function handleProviderChange(provider: ProviderSettings['provider']) {
    setProviderSettings({
      ...providerSettings,
      provider,
      model: PROVIDER_MODELS[provider][0],
    });
  }

  const loading = loadingPhase !== 'idle';
  const wordCount = countWords(input);
  const overLimit = wordCount > WORD_LIMIT;

  async function send() {
    const q = input.trim();
    if (!q || loading || overLimit) return;

    const currentClarification = pendingClarification;
    const apiQuestion = currentClarification
      ? `${currentClarification.originalQuestion} [User clarified: ${q}]`
      : q;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: q };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setPendingClarification(null);
    setReformulatedDisplay(null);

    try {
      // ── Phase 1: Reformulation ─────────────────────────────────────────
      setLoadingPhase('thinking');
      let reformulatedQuery: string | undefined;

      if (!currentClarification) {
        try {
          const refRes = await fetch('/api/reformulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: q }),
          });
          if (refRes.ok) {
            const refJson = await refRes.json();
            reformulatedQuery = refJson.reformulated_query;
            if (reformulatedQuery && reformulatedQuery !== q) {
              setReformulatedDisplay(reformulatedQuery);
            }
          }
        } catch {
          // Non-fatal; fall through to use original question
        }
      }

      // ── Phase 2: Retrieval + generation ────────────────────────────────
      setLoadingPhase('searching');

      // Brief delay so "Searching..." is visible before moving to generating
      await new Promise((r) => setTimeout(r, 600));
      setLoadingPhase('generating');

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: apiQuestion,
          reformulated_query: reformulatedQuery,
          providerSettings,
          compare: compareMode,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        const err = json as ApiError;
        setPendingClarification(currentClarification);
        setMessages((m) => [
          ...m,
          { id: crypto.randomUUID(), role: 'assistant', content: err.error?.message ?? 'An error occurred.' },
        ]);
      } else {
        const data = json as ChatResponse;

        if (data.needs_clarification && data.clarifying_question) {
          setPendingClarification({ originalQuestion: apiQuestion });
          setMessages((m) => [
            ...m,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: data.clarifying_question!,
              data,
              isClarification: true,
            },
          ]);
        } else {
          setMessages((m) => [
            ...m,
            { id: crypto.randomUUID(), role: 'assistant', content: data.answer, data },
          ]);
        }
      }
    } catch {
      setPendingClarification(currentClarification);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'assistant', content: 'Network error. Please try again.' },
      ]);
    } finally {
      setLoadingPhase('idle');
      setReformulatedDisplay(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-400">
        Ask any question — I will answer from The Clear Quran with cited ayahs.
      </p>

      {/* Message list */}
      <div className="flex flex-col gap-3 min-h-[300px]">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-emerald-600 text-white'
                  : msg.isClarification
                  ? 'bg-amber-900/40 border border-amber-600/50 text-slate-100'
                  : 'bg-slate-800 text-slate-100'
              }`}
            >
              {msg.isClarification && (
                <p className="text-[10px] font-semibold text-amber-400 mb-1 uppercase tracking-wide">
                  🤔 Need a bit more info
                </p>
              )}

              {/* Reformulated query indicator (for assistant messages) */}
              {msg.data?.reformulated_query && !msg.isClarification && (
                <p className="text-[10px] text-slate-500 mb-2 italic">
                  🔍 Searched for: &ldquo;{msg.data.reformulated_query}&rdquo;
                </p>
              )}

              <p className="whitespace-pre-wrap">{msg.content}</p>

              {/* Citations */}
              {msg.data && !msg.isClarification && msg.data.citations.length > 0 && (
                <div className="mt-3 border-t border-slate-600 pt-2 flex flex-col gap-2">
                  {msg.data.citations.map((c, i) => (
                    <a
                      key={i}
                      href={`/${c.surah}/${c.ayah}`}
                      className="block bg-emerald-900/60 border border-emerald-700 rounded-lg px-3 py-2 hover:bg-emerald-800 transition-colors"
                    >
                      <span className="text-xs font-semibold text-emerald-300">{c.reference}</span>
                      <p className="text-xs text-slate-300 mt-1 italic">&ldquo;{c.quote}&rdquo;</p>
                    </a>
                  ))}
                </div>
              )}

              {/* Metadata */}
              {msg.data && !msg.isClarification && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      msg.data.confidence === 'high'
                        ? 'bg-green-700/50 text-green-300'
                        : msg.data.confidence === 'medium'
                        ? 'bg-yellow-700/50 text-yellow-300'
                        : 'bg-red-700/50 text-red-300'
                    }`}
                  >
                    {msg.data.confidence}
                  </span>
                  <span className="text-[10px] text-slate-500">{msg.data.source_policy}</span>
                  {msg.data.limitations && (
                    <span className="text-[10px] text-amber-400">⚠ {msg.data.limitations}</span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    {msg.data._comparison && (
                      <button
                        onClick={() => setCompareMsgId(compareMsgId === msg.id ? null : msg.id)}
                        title="Toggle pipeline comparison"
                        className="text-[11px] text-slate-500 hover:text-sky-400 transition-colors"
                        aria-label="Pipeline comparison"
                      >
                        ⚖️
                      </button>
                    )}
                    {msg.data.debug && (
                      <button
                        onClick={() => setDebugMsgId(debugMsgId === msg.id ? null : msg.id)}
                        title="Open debug panel"
                        className="text-[11px] text-slate-500 hover:text-emerald-400 transition-colors"
                        aria-label="Debug info"
                      >
                        🔬
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Debug button for clarification messages */}
              {msg.isClarification && msg.data?.debug && (
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => setDebugMsgId(debugMsgId === msg.id ? null : msg.id)}
                    title="Open debug panel"
                    className="text-[11px] text-slate-500 hover:text-emerald-400 transition-colors"
                    aria-label="Debug info"
                  >
                    🔬
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Inline comparison panel below the relevant message */}
        {compareMsgId && (() => {
          const msg = messages.find((m) => m.id === compareMsgId);
          return msg?.data?._comparison ? (
            <ComparisonPanel
              comparison={msg.data._comparison}
              onClose={() => setCompareMsgId(null)}
            />
          ) : null;
        })()}

        {/* Multi-phase loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-2xl px-4 py-3 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:0ms]" />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:150ms]" />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:300ms]" />
                <span className="ml-1">{PHASE_LABELS[loadingPhase as Exclude<LoadingPhase, 'idle'>]}</span>
              </div>
              {reformulatedDisplay && (
                <p className="text-[11px] text-slate-500 mt-1 italic">
                  🔍 &ldquo;{reformulatedDisplay}&rdquo;
                </p>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Clarification hint */}
      {pendingClarification && !loading && (
        <p className="text-xs text-amber-400 text-center animate-pulse">
          ↑ Reply to clarify your question above
        </p>
      )}

      {/* ── Settings panel ─────────────────────────────────────────────── */}
      {showSettings && (
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-3 flex flex-wrap gap-3 items-end text-xs">
          {/* Provider */}
          <div className="flex flex-col gap-1">
            <label className="text-slate-500 uppercase tracking-wide text-[10px]">Provider</label>
            <select
              value={providerSettings.provider}
              onChange={(e) => handleProviderChange(e.target.value as ProviderSettings['provider'])}
              className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-200 outline-none focus:border-emerald-500"
            >
              <option value="opencode">OpenCode (minimax)</option>
              <option value="claude">Claude (Anthropic)</option>
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>

          {/* Model */}
          <div className="flex flex-col gap-1">
            <label className="text-slate-500 uppercase tracking-wide text-[10px]">Model</label>
            <select
              value={providerSettings.model}
              onChange={(e) => setProviderSettings({ ...providerSettings, model: e.target.value })}
              className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-200 outline-none focus:border-emerald-500 max-w-[220px]"
            >
              {PROVIDER_MODELS[providerSettings.provider].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Temperature */}
          <div className="flex flex-col gap-1">
            <label className="text-slate-500 uppercase tracking-wide text-[10px]">
              Temperature: {providerSettings.temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={providerSettings.temperature}
              onChange={(e) =>
                setProviderSettings({ ...providerSettings, temperature: parseFloat(e.target.value) })
              }
              className="w-28 accent-emerald-500"
            />
          </div>

          {/* Compare mode toggle */}
          <div className="flex flex-col gap-1">
            <label className="text-slate-500 uppercase tracking-wide text-[10px]">Pipeline Compare</label>
            <button
              onClick={() => setCompareMode((c) => !c)}
              className={`px-3 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
                compareMode
                  ? 'bg-sky-700/60 border-sky-500 text-sky-200'
                  : 'bg-slate-700 border-slate-600 text-slate-400 hover:border-slate-500'
              }`}
            >
              {compareMode ? '⚖️ On' : '⚖️ Off'}
            </button>
          </div>
        </div>
      )}

      {/* ── Input row ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <textarea
            rows={2}
            className={`flex-1 rounded-xl bg-slate-800 border px-4 py-3 text-sm outline-none transition-colors placeholder:text-slate-500 resize-none ${
              overLimit
                ? 'border-red-500 focus:border-red-400'
                : pendingClarification
                ? 'border-amber-600 focus:border-amber-400'
                : 'border-slate-700 focus:border-emerald-500'
            }`}
            placeholder={
              pendingClarification
                ? 'Type your clarification…'
                : 'Ask anything — e.g. "What does the Quran say about patience?"'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            disabled={loading}
          />
          <div className="flex flex-col gap-1.5">
            <button
              onClick={send}
              disabled={loading || !input.trim() || overLimit}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl px-5 py-2 text-sm font-medium transition-colors"
            >
              Send
            </button>
            <button
              onClick={() => setShowSettings((s) => !s)}
              title="Provider settings"
              className={`rounded-xl px-3 py-2 text-sm transition-colors ${
                showSettings
                  ? 'bg-slate-600 text-slate-200'
                  : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-500'
              }`}
              aria-label="Toggle settings"
            >
              ⚙️
            </button>
          </div>
        </div>

        {/* Word counter */}
        <div className="flex justify-end">
          <span
            className={`text-[10px] ${
              overLimit ? 'text-red-400' : wordCount >= WORD_LIMIT - 5 ? 'text-amber-400' : 'text-slate-600'
            }`}
          >
            {wordCount}/{WORD_LIMIT} words
            {overLimit && ' — please shorten your question'}
          </span>
        </div>
      </div>

      {/* Debug panel — rendered outside message list to avoid z-index issues */}
      {debugMsgId && (() => {
        const msg = messages.find((m) => m.id === debugMsgId);
        return msg?.data?.debug ? (
          <DebugPanel debug={msg.data.debug} onClose={() => setDebugMsgId(null)} />
        ) : null;
      })()}
    </div>
  );
}
