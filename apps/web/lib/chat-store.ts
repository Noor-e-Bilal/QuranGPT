import { MongoClient, Db } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/quransays';

// Cache promise on globalThis so Next.js hot-reload doesn't create duplicate pools.
// On connection failure the promise is cleared so the next call retries.
declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClientPromise(): Promise<MongoClient> {
  if (!globalThis._mongoClientPromise) {
    const client = new MongoClient(MONGODB_URI);
    globalThis._mongoClientPromise = client
      .connect()
      .then(async (c) => {
        await ensureIndexes(c.db());
        return c;
      })
      .catch((err) => {
        globalThis._mongoClientPromise = undefined; // allow retry on next request
        throw err;
      });
  }
  return globalThis._mongoClientPromise;
}

async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db();
}

async function ensureIndexes(db: Db): Promise<void> {
  await db.collection('chats').createIndex({ user_id: 1, updated_at: -1 });
  await db.collection('messages').createIndex({ chat_id: 1, created_at: 1 });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoredChat {
  id: string;
  user_id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface StoredMessage {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  data: string | null;
  created_at: number;
}

// MongoDB documents use _id = UUID string
interface ChatDoc {
  _id: string;
  user_id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface MessageDoc {
  _id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  data: string | null;
  created_at: number;
}

function toChat(doc: ChatDoc): StoredChat {
  return { id: doc._id, user_id: doc.user_id, title: doc.title, created_at: doc.created_at, updated_at: doc.updated_at };
}

function toMessage(doc: MessageDoc): StoredMessage {
  return { id: doc._id, chat_id: doc.chat_id, role: doc.role, content: doc.content, data: doc.data, created_at: doc.created_at };
}

// ── Chats ─────────────────────────────────────────────────────────────────────

export async function createChat(id: string, userId: string, title: string): Promise<StoredChat> {
  const now = Date.now();
  const db = await getDb();
  await db.collection<ChatDoc>('chats').insertOne({ _id: id, user_id: userId, title, created_at: now, updated_at: now });
  return { id, user_id: userId, title, created_at: now, updated_at: now };
}

export async function listChats(userId: string): Promise<StoredChat[]> {
  const db = await getDb();
  const docs = await db.collection<ChatDoc>('chats').find({ user_id: userId }).sort({ updated_at: -1 }).toArray();
  return docs.map(toChat);
}

export async function getChat(chatId: string): Promise<StoredChat | null> {
  const db = await getDb();
  const doc = await db.collection<ChatDoc>('chats').findOne({ _id: chatId });
  return doc ? toChat(doc) : null;
}

export async function updateChatTitle(chatId: string, title: string): Promise<void> {
  const db = await getDb();
  await db.collection<ChatDoc>('chats').updateOne({ _id: chatId }, { $set: { title, updated_at: Date.now() } });
}

export async function touchChat(chatId: string): Promise<void> {
  const db = await getDb();
  await db.collection<ChatDoc>('chats').updateOne({ _id: chatId }, { $set: { updated_at: Date.now() } });
}

export async function deleteChat(chatId: string): Promise<void> {
  const db = await getDb();
  // Delete messages first — if chat delete then fails, we have an empty-but-visible
  // chat (recoverable) rather than invisible orphaned messages (irrecoverable).
  await db.collection<MessageDoc>('messages').deleteMany({ chat_id: chatId });
  await db.collection<ChatDoc>('chats').deleteOne({ _id: chatId });
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function addMessage(
  id: string,
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
  data: object | null,
): Promise<StoredMessage> {
  const now = Date.now();
  const dataStr = data ? JSON.stringify(data) : null;
  const db = await getDb();
  await db.collection<MessageDoc>('messages').insertOne({ _id: id, chat_id: chatId, role, content, data: dataStr, created_at: now });
  await touchChat(chatId);
  return { id, chat_id: chatId, role, content, data: dataStr, created_at: now };
}

export async function getMessages(chatId: string): Promise<StoredMessage[]> {
  const db = await getDb();
  const docs = await db.collection<MessageDoc>('messages').find({ chat_id: chatId }).sort({ created_at: 1 }).toArray();
  return docs.map(toMessage);
}
