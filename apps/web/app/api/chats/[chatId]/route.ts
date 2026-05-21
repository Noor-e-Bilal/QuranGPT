import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  getChat,
  getMessages,
  addMessage,
  updateChatTitle,
  deleteChat,
} from '@/lib/chat-store';

type RouteContext = { params: { chatId: string } };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  const chat = await getChat(params.chatId);
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }
  if (chat.user_id !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const messages = await getMessages(params.chatId);
  return NextResponse.json({ chat, messages });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  const chat = await getChat(params.chatId);
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }
  if (chat.user_id !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    message?: { role?: unknown; content?: unknown; data?: unknown };
    title?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Rename chat
  if (typeof body.title === 'string' && body.title.trim()) {
    await updateChatTitle(params.chatId, body.title.trim().slice(0, 80));
    return NextResponse.json({ ok: true });
  }

  // Add a message
  if (body.message) {
    const { role, content, data } = body.message;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'message.role and message.content are required' }, { status: 400 });
    }
    const stored = await addMessage(
      uuidv4(),
      params.chatId,
      role,
      content.trim(),
      data && typeof data === 'object' ? (data as object) : null,
    );
    return NextResponse.json({ message: stored });
  }

  return NextResponse.json({ error: 'Provide either message or title in body' }, { status: 400 });
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  const chat = await getChat(params.chatId);
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  }
  if (chat.user_id !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await deleteChat(params.chatId);
  return NextResponse.json({ ok: true });
}
