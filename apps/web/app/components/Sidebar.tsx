'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useChatHistory } from '@/app/chat/ChatHistoryContext';

interface ChatSummary {
  id: string;
  title: string;
  updated_at: number;
}

const ANON_ID_KEY = 'quransays_anon_id';

function getOrCreateAnonId(): string {
  let id = localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
          });
    localStorage.setItem(ANON_ID_KEY, id);
  }
  return id;
}

export function useUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    setUserId(getOrCreateAnonId());
  }, []);
  return userId;
}

interface SidebarProps {
  /** Called when a new chat is successfully created. */
  onNewChat?: (chatId: string) => void;
}

export default function Sidebar({ onNewChat }: SidebarProps) {
  const router = useRouter();
  const params = useParams<{ chatId?: string }>();
  const activeChatId = params?.chatId ?? null;

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { refreshToken } = useChatHistory();

  // Resolve userId on mount (client-only — localStorage unavailable on server)
  useEffect(() => {
    setUserId(getOrCreateAnonId());
  }, []);

  const loadChats = useCallback(async (uid: string) => {
    try {
      const res = await fetch(`/api/chats?userId=${encodeURIComponent(uid)}`);
      if (res.ok) {
        const json = await res.json();
        setChats(json.chats ?? []);
      }
    } catch {
      // Silently ignore network errors — sidebar is non-critical
    }
  }, []);

  // Single effect: re-run whenever userId, activeChatId, or refreshToken changes.
  // Merging the two separate effects prevents duplicate fetches on initial mount
  // when userId first resolves (both effects would have fired simultaneously).
  useEffect(() => {
    if (userId) loadChats(userId);
  }, [userId, activeChatId, loadChats, refreshToken]);

  async function handleNewChat() {
    if (!userId || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        const { chat } = await res.json();
        await loadChats(userId);
        onNewChat?.(chat.id);
        router.push(`/chat/${chat.id}`);
      }
    } catch {
      // Non-fatal
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteChat(e: React.MouseEvent, chatId: string) {
    e.stopPropagation();
    e.preventDefault();
    if (!userId) return;
    try {
      await fetch(`/api/chats/${chatId}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      if (userId) await loadChats(userId);
      if (activeChatId === chatId) {
        router.push('/chat');
      }
    } catch {
      // Non-fatal
    }
  }

  function formatDate(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  return (
    <aside
      className="flex flex-col bg-emerald-950 border-r border-emerald-800 h-full overflow-hidden"
      style={{ width: 260, minWidth: 260 }}
    >
      {/* Header */}
      <div className="px-3 py-4 border-b border-emerald-800">
        <button
          onClick={handleNewChat}
          disabled={creating}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-700/40 hover:bg-emerald-700/70 border border-emerald-700/60 text-emerald-200 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <span className="text-lg leading-none">✏️</span>
          {creating ? 'Creating…' : 'New chat'}
        </button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {chats.length === 0 && userId && (
          <p className="text-xs text-slate-500 text-center mt-6 px-4">
            No chats yet — start a new one above.
          </p>
        )}
        {chats.map((chat) => (
          <div
            key={chat.id}
            onClick={() => router.push(`/chat/${chat.id}`)}
            className={`group relative flex items-start gap-2 px-3 py-2.5 mx-1 rounded-lg cursor-pointer transition-colors ${
              activeChatId === chat.id
                ? 'bg-emerald-800/60 text-slate-100'
                : 'hover:bg-emerald-900/60 text-slate-300'
            }`}
          >
            <span className="text-base leading-none mt-0.5 shrink-0">💬</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate leading-snug">{chat.title}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(chat.updated_at)}</p>
            </div>
            {/* Delete button — visible on hover */}
            <button
              onClick={(e) => handleDeleteChat(e, chat.id)}
              title="Delete chat"
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all text-[13px] p-0.5 rounded"
              aria-label="Delete chat"
            >
              🗑
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-emerald-800">
        <p className="text-[10px] text-slate-600 text-center truncate">
          📖 QuranSays
        </p>
      </div>
    </aside>
  );
}
