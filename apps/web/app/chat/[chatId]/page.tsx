'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { ChatResponse, ApiError, ProviderSettings, ComparePanelResult } from '@/lib/types';
import { PROVIDER_MODELS, DEFAULT_PROVIDER_SETTINGS } from '@/lib/types';
import DebugPanel from '@/app/components/DebugPanel';
import ComparisonView from '@/app/components/ComparisonView';
import { useChatHistory } from '@/app/chat/ChatHistoryContext';

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as Crypto).randomUUID === 'function') {
    return (crypto as Crypto).randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  data?: ChatResponse;
  isClarification?: boolean;
  isComparison?: boolean;
  reformulatedQuery?: string;
  compareRight?: ComparePanelResult;
  compareRightLoading?: boolean;
  compareRightError?: string;
}

type LoadingPhase = 'idle' | 'thinking' | 'searching' | 'generating';

const PHASE_LABELS: Record<Exclude<LoadingPhase, 'idle'>, string> = {
  thinking: 'Thinking…',
  searching: 'Searching The Clear Quran…',
  generating: 'Composing answer…',
};

const WORD_LIMIT = 30;
const TITLE_MAX_LEN = 45;

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function makeChatTitle(firstUserMessage: string): string {
  const t = firstUserMessage.trim();
  return t.length > TITLE_MAX_LEN ? t.slice(0, TITLE_MAX_LEN - 1) + '…' : t;
}

const ANON_ID_KEY = 'quransays_anon_id';

function getAnonId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(ANON_ID_KEY);
}

export default function ChatPage() {
  const router = useRouter();
  const { chatId } = useParams<{ chatId: string }>();
  const { refreshChats } = useChatHistory();

  const [messages, setMessages] = useState<Message[]>([]);
  const [chatTitle, setChatTitle] = useState<string>('New Chat');
  const [input, setInput] = useState('');
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('idle');
  const [reformulatedDisplay, setReformulatedDisplay] = useState<string | null>(null);
  const [debugMsgId, setDebugMsgId] = useState<string | null>(null);
  const [pendingClarification, setPendingClarification] = useState<{ originalQuestion: string } | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(DEFAULT_PROVIDER_SETTINGS);
  const [compareMode, setCompareMode] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const titleSetRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loadingPhase]);

  // Load chat history when chatId changes
  useEffect(() => {
    if (!chatId) return;
    setMessages([]);
    setHistoryLoaded(false);
    setNotFound(false);
    titleSetRef.current = false;

    async function loadHistory() {
      try {
        const res = await fetch(`/api/chats/${chatId}`);
        if (res.status === 404) {
          setNotFound(true);
          setHistoryLoaded(true);
          return;
        }
        if (!res.ok) {
          setHistoryLoaded(true);
          return;
        }
        const json = await res.json();
        setChatTitle(json.chat.title);
        titleSetRef.current = json.chat.title !== 'New Chat';

        const stored: Array<{
          id: string;
          role: 'user' | 'assistant';
          content: string;
          data: string | null;
        }> = json.messages ?? [];

        const restored: Message[] = stored.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          data: m.data ? (JSON.parse(m.data) as ChatResponse) : undefined,
        }));
        setMessages(restored);
      } catch {
        // Network error — start fresh
      } finally {
        setHistoryLoaded(true);
      }
    }

    loadHistory();
  }, [chatId]);

  function handleProviderChange(provider: ProviderSettings['provider']) {
    setProviderSettings({
      ...providerSettings,
      provider,
      model: PROVIDER_MODELS[provider][0],
    });
  }

  /** Persist a message to the DB (non-blocking, best-effort). */
  const persistMessage = useCallback(
    async (role: 'user' | 'assistant', content: string, data: object | null) => {
      try {
        await fetch(`/api/chats/${chatId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { role, content, data } }),
        });
      } catch {
        // Best-effort — don't block the UI
      }
    },
    [chatId],
  );

  /** Set chat title from first user message (best-effort, once per chat). */
  const setTitleFromFirstMessage = useCallback(
    async (firstMessage: string) => {
      if (titleSetRef.current) return;
      titleSetRef.current = true;
      const title = makeChatTitle(firstMessage);
      setChatTitle(title);
      try {
        await fetch(`/api/chats/${chatId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        // Notify sidebar to reload so new title appears immediately
        refreshChats();
      } catch {
        // Best-effort
      }
    },
    [chatId, refreshChats],
  );

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

    const userMsg: Message = { id: uuid(), role: 'user', content: q };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setPendingClarification(null);
    setReformulatedDisplay(null);

    // Persist user message; set title from first message
    persistMessage('user', q, null);
    const isFirstUserMsg = messages.filter((m) => m.role === 'user').length === 0;
    if (isFirstUserMsg && !currentClarification) {
      setTitleFromFirstMessage(q);
    }

    try {
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
          // Non-fatal; fall through
        }
      }

      setLoadingPhase('searching');
      await new Promise((r) => setTimeout(r, 600));
      setLoadingPhase('generating');

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: apiQuestion,
          reformulated_query: reformulatedQuery,
          providerSettings,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        const err = json as ApiError;
        setPendingClarification(currentClarification);
        const errMsg = err.error?.message ?? 'An error occurred.';
        setMessages((m) => [...m, { id: uuid(), role: 'assistant', content: errMsg }]);
        persistMessage('assistant', errMsg, null);
      } else {
        const data = json as ChatResponse;

        if (data.needs_clarification && data.clarifying_question) {
          setPendingClarification({ originalQuestion: apiQuestion });
          const clarMsg: Message = {
            id: uuid(),
            role: 'assistant',
            content: data.clarifying_question!,
            data,
            isClarification: true,
          };
          setMessages((m) => [...m, clarMsg]);
          persistMessage('assistant', data.clarifying_question!, data);
        } else {
          const msgId = uuid();

          if (compareMode) {
            const compareMsg: Message = {
              id: msgId,
              role: 'assistant',
              content: data.answer,
              data,
              isComparison: true,
              reformulatedQuery: reformulatedQuery ?? undefined,
              compareRightLoading: true,
            };
            setMessages((m) => [...m, compareMsg]);
            persistMessage('assistant', data.answer, data);

            fetch('/api/compare', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                question: apiQuestion,
                reformulated_query: reformulatedQuery,
                providerSettings,
              }),
            })
              .then(async (r) => {
                const body = await r.json();
                if (!r.ok) {
                  const msg: string = (body as { error?: { message?: string } })?.error?.message ?? 'Upgrade pipeline failed.';
                  return Promise.reject(msg);
                }
                return body as ComparePanelResult;
              })
              .then((panel: ComparePanelResult) => {
                setMessages((m) =>
                  m.map((msg) =>
                    msg.id === msgId
                      ? { ...msg, compareRight: panel, compareRightLoading: false }
                      : msg,
                  ),
                );
              })
              .catch((errMsg: unknown) => {
                const displayError = typeof errMsg === 'string' ? errMsg : 'Upgrade pipeline failed — try again.';
                setMessages((m) =>
                  m.map((msg) =>
                    msg.id === msgId
                      ? { ...msg, compareRightLoading: false, compareRightError: displayError }
                      : msg,
                  ),
                );
              });
          } else {
            setMessages((m) => [...m, { id: msgId, role: 'assistant', content: data.answer, data }]);
            persistMessage('assistant', data.answer, data);
          }
        }
      }
    } catch {
      setPendingClarification(currentClarification);
      setMessages((m) => [
        ...m,
        { id: uuid(), role: 'assistant', content: 'Network error. Please try again.' },
      ]);
    } finally {
      setLoadingPhase('idle');
      setReformulatedDisplay(null);
    }
  }

  // Not-found guard: redirect to /chat so sidebar creates a fresh one
  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
        <p className="text-lg">Chat not found.</p>
        <button
          onClick={() => router.push('/chat')}
          className="text-sm text-emerald-400 hover:underline"
        >
          Start a new chat →
        </button>
      </div>
    );
  }

  // Loading skeleton while restoring history
  if (!historyLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:0ms]" />
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:150ms]" />
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:300ms]" />
          <span className="ml-2">Loading…</span>
        </div>
      </div>
    );
  }

  const isEmptyChat = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Chat title bar */}
      <div className="px-5 py-3 border-b border-emerald-900/60 flex items-center gap-2 shrink-0">
        <span className="text-sm font-medium text-slate-300 truncate">{chatTitle}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {isEmptyChat && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
              <span className="text-4xl">📖</span>
              <p className="text-base font-medium text-slate-400">Ask anything from the Quran</p>
              <p className="text-sm text-center max-w-xs">
                I answer every question with cited ayahs from The Clear Quran translation.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : msg.isComparison ? 'w-full' : 'justify-start'}`}
            >
              {msg.isComparison && msg.data ? (
                <div className="w-full">
                  <ComparisonView
                    left={msg.data}
                    leftReformulatedQuery={msg.reformulatedQuery ?? msg.data.reformulated_query}
                    right={msg.compareRight ?? null}
                    rightLoading={msg.compareRightLoading ?? false}
                    rightError={msg.compareRightError}
                    onDebug={(msg.data.debug || msg.compareRight?.debug) ? () => setDebugMsgId(msg.id) : undefined}
                  />
                </div>
              ) : (
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

                  {msg.data?.reformulated_query && !msg.isClarification && (
                    <p className="text-[10px] text-slate-500 mb-2 italic">
                      🔍 Searched for: &ldquo;{msg.data.reformulated_query}&rdquo;
                    </p>
                  )}

                  <p className="whitespace-pre-wrap">{msg.content}</p>

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

                  {msg.data && !msg.isClarification && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-slate-500">{msg.data.source_policy}</span>
                      {msg.data.cache_info && msg.data.cache_info.strategy !== 'miss' && (
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            msg.data.cache_info.strategy === 'exact'
                              ? 'bg-green-900/60 text-green-300'
                              : 'bg-sky-900/60 text-sky-300'
                          }`}
                          title={
                            msg.data.cache_info.strategy === 'semantic'
                              ? `Semantic cache hit — ${(msg.data.cache_info.similarity! * 100).toFixed(1)}% match`
                              : 'Exact cache hit'
                          }
                        >
                          ⚡{' '}
                          {msg.data.cache_info.strategy === 'semantic'
                            ? `cache ~${(msg.data.cache_info.similarity! * 100).toFixed(0)}%`
                            : 'cached'}
                        </span>
                      )}
                      {msg.data.debug && (
                        <div className="ml-auto">
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
                  )}

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
              )}
            </div>
          ))}

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
      </div>

      {/* Clarification hint */}
      {pendingClarification && !loading && (
        <p className="text-xs text-amber-400 text-center py-1 animate-pulse shrink-0">
          ↑ Reply to clarify your question above
        </p>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div className="mx-4 mb-2 bg-slate-800/80 border border-slate-700 rounded-xl p-3 flex flex-wrap gap-3 items-end text-xs shrink-0">
          <div className="flex flex-col gap-1">
            <label className="text-slate-500 uppercase tracking-wide text-[10px]">Provider</label>
            <select
              value={providerSettings.provider}
              onChange={(e) => handleProviderChange(e.target.value as ProviderSettings['provider'])}
              className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-200 outline-none focus:border-emerald-500"
            >
              <option value="opencode">OpenCode.ai (free)</option>
              <option value="claude">Claude (Anthropic)</option>
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>
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

      {/* Input row */}
      <div className="px-4 pb-4 shrink-0">
        <div className="max-w-3xl mx-auto flex flex-col gap-1.5">
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
      </div>

      {/* Debug panel */}
      {debugMsgId && (() => {
        const msg = messages.find((m) => m.id === debugMsgId);
        return (msg?.data?.debug || msg?.compareRight?.debug) ? (
          <DebugPanel
            debug={msg.data?.debug}
            upgradeDebug={msg.compareRight?.debug}
            onClose={() => setDebugMsgId(null)}
          />
        ) : null;
      })()}
    </div>
  );
}
