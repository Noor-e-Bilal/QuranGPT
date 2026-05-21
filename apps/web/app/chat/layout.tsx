'use client';

import Sidebar from '@/app/components/Sidebar';
import { ChatHistoryProvider } from './ChatHistoryContext';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatHistoryProvider>
      <div className="flex h-[calc(100vh-57px)]">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </ChatHistoryProvider>
  );
}
