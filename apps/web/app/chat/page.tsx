'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUserId } from '@/app/components/Sidebar';

export default function ChatIndexPage() {
  const router = useRouter();
  const userId = useUserId();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function redirectToChat() {
      // Try to find the most recent existing chat
      try {
        const res = await fetch(`/api/chats?userId=${encodeURIComponent(userId!)}`);
        if (res.ok) {
          const json = await res.json();
          const chats: Array<{ id: string }> = json.chats ?? [];
          if (chats.length > 0) {
            if (!cancelled) router.replace(`/chat/${chats[0].id}`);
            return;
          }
        }
      } catch {
        // Fall through to create new chat
      }

      // No existing chats — create a new one
      try {
        const res = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        if (res.ok) {
          const { chat } = await res.json();
          if (!cancelled) router.replace(`/chat/${chat.id}`);
        }
      } catch {
        // Non-fatal; user sees a blank screen — acceptable edge case
      }
    }

    redirectToChat();
    return () => { cancelled = true; };
  }, [userId, router]);

  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:0ms]" />
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:150ms]" />
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:300ms]" />
        <span className="ml-2">Loading chats…</span>
      </div>
    </div>
  );
}
