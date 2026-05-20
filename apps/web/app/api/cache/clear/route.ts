import { NextResponse } from 'next/server';
import { clearCache } from '@/lib/cache';

/**
 * DELETE /api/cache/clear
 * Flushes all cache tiers (in-memory LRU + Valkey + ChromaDB semantic cache).
 * Dev-only utility — protected by a simple token check in production.
 */
export async function DELETE(_req: Request): Promise<NextResponse> {
  const secret = process.env.CACHE_CLEAR_SECRET;
  if (secret) {
    const auth = _req.headers.get('x-cache-secret') ?? '';
    if (auth !== secret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  await clearCache();
  return NextResponse.json({ ok: true, message: 'All cache tiers cleared.' });
}
