'use client';

import { createContext, useContext, useState, useCallback } from 'react';

interface ChatHistoryContextValue {
  /** Increment this to trigger a sidebar reload */
  refreshToken: number;
  /** Call after a title/message change that should appear in sidebar */
  refreshChats: () => void;
}

export const ChatHistoryContext = createContext<ChatHistoryContextValue>({
  refreshToken: 0,
  refreshChats: () => {},
});

export function useChatHistory() {
  return useContext(ChatHistoryContext);
}

export function ChatHistoryProvider({ children }: { children: React.ReactNode }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const refreshChats = useCallback(() => setRefreshToken((t) => t + 1), []);
  return (
    <ChatHistoryContext.Provider value={{ refreshToken, refreshChats }}>
      {children}
    </ChatHistoryContext.Provider>
  );
}
