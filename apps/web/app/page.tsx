'use client';

import { useState, useRef, useEffect } from 'react';
import type { ChatResponse, ApiError } from '@/lib/types';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  data?: ChatResponse;
  isClarification?: boolean;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // Track when the user is answering a clarification request
  const [pendingClarification, setPendingClarification] = useState<{ originalQuestion: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const q = input.trim();
    if (!q || loading) return;

    // Capture before clearing so we can restore on failure
    const currentClarification = pendingClarification;

    // If answering a clarification, combine with original question
    const apiQuestion = currentClarification
      ? `${currentClarification.originalQuestion} [User clarified: ${q}]`
      : q;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: q };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setPendingClarification(null);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: apiQuestion }),
      });
      const json = await res.json();

      if (!res.ok) {
        const err = json as ApiError;
        // Restore clarification context so user can retry
        setPendingClarification(currentClarification);
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: err.error?.message ?? 'An error occurred.',
          },
        ]);
      } else {
        const data = json as ChatResponse;

        if (data.needs_clarification && data.clarifying_question) {
          // Show clarifying question; remember original question for next send
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
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: data.answer,
              data,
            },
          ]);
        }
      }
    } catch {
      // Restore clarification context so user can retry
      setPendingClarification(currentClarification);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'assistant', content: 'Network error. Please try again.' },
      ]);
    } finally {
      setLoading(false);
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
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-2xl px-4 py-3 text-sm text-slate-400 animate-pulse">
              Searching The Clear Quran…
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

      {/* Input */}
      <div className="flex gap-2 mt-2">
        <input
          className={`flex-1 rounded-xl bg-slate-800 border px-4 py-3 text-sm outline-none transition-colors placeholder:text-slate-500 ${
            pendingClarification
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
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl px-5 py-3 text-sm font-medium transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
