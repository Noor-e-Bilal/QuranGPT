import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createChat, listChats } from '@/lib/chat-store';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId || !userId.trim()) {
    return NextResponse.json({ error: 'userId query param required' }, { status: 400 });
  }
  const chats = await listChats(userId.trim());
  return NextResponse.json({ chats });
}

export async function POST(req: NextRequest) {
  let body: { userId?: unknown; title?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const title = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim().slice(0, 80)
    : 'New Chat';

  const chat = await createChat(uuidv4(), userId, title);
  return NextResponse.json({ chat }, { status: 201 });
}
