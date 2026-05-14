import { NextRequest, NextResponse } from 'next/server';
import { retrieveComparison } from '@/lib/retrieval';
import type { ComparisonBundle } from '@/lib/types';

export async function POST(req: NextRequest) {
  let body: { query?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return NextResponse.json({ error: '"query" is required' }, { status: 400 });
  }

  try {
    const comparison: ComparisonBundle = await retrieveComparison(query);
    return NextResponse.json(comparison);
  } catch (err) {
    console.error('[/api/compare] error:', err);
    return NextResponse.json({ error: 'Comparison pipeline failed' }, { status: 500 });
  }
}
