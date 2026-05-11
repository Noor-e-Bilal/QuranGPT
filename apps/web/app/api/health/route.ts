import { NextResponse } from 'next/server';
import { checkDbHealth } from '@/lib/db';
import { checkChromaHealth } from '@/lib/chroma';
import type { HealthResponse } from '@/lib/types';

export async function GET() {
  const [db, vector_store] = await Promise.all([
    Promise.resolve(checkDbHealth()),
    checkChromaHealth(),
  ]);

  const status: HealthResponse = {
    status: db && vector_store ? 'ok' : 'degraded',
    checks: { db, vector_store },
    ts: new Date().toISOString(),
  };

  return NextResponse.json(status, {
    status: status.status === 'ok' ? 200 : 503,
  });
}
