import { NextRequest, NextResponse } from 'next/server';
import { reformulateQuery } from '@/lib/llm';
import type { ApiError } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
  const requestId = uuidv4();

  let body: { question?: unknown };
  try {
    body = await req.json();
  } catch {
    const err: ApiError = {
      error: { code: 'BAD_REQUEST', message: 'JSON body required.', request_id: requestId },
    };
    return NextResponse.json(err, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) {
    const err: ApiError = {
      error: { code: 'BAD_REQUEST', message: '"question" must be a non-empty string.', request_id: requestId },
    };
    return NextResponse.json(err, { status: 400 });
  }

  try {
    const reformulated = await reformulateQuery(question);
    return NextResponse.json({ original: question, reformulated_query: reformulated });
  } catch (err) {
    console.error('[/api/reformulate]', err);
    // Gracefully fall back to original question on any error
    return NextResponse.json({ original: question, reformulated_query: question });
  }
}
