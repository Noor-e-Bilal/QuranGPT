import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { retrieve } from '@/lib/retrieval';
import { generateChatResponse } from '@/lib/llm';
import { buildChatResponse, fallbackChatResponse } from '@/lib/validator';
import type { ApiError } from '@/lib/types';

// Simple in-memory rate limiter: 10 req/min per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const requestId = uuidv4();
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1';

  if (!checkRateLimit(ip)) {
    const err: ApiError = {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a minute and try again.',
        request_id: requestId,
      },
    };
    return NextResponse.json(err, { status: 429 });
  }

  let body: { question?: unknown };
  try {
    body = await req.json();
  } catch {
    const err: ApiError = {
      error: {
        code: 'BAD_REQUEST',
        message: 'Request body must be JSON with a "question" field.',
        request_id: requestId,
      },
    };
    return NextResponse.json(err, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) {
    const err: ApiError = {
      error: {
        code: 'BAD_REQUEST',
        message: '"question" must be a non-empty string.',
        request_id: requestId,
      },
    };
    return NextResponse.json(err, { status: 400 });
  }

  try {
    const evidence = await retrieve(question);
    const llmOutput = await generateChatResponse(question, evidence);

    // If retrieval found nothing and the LLM isn't asking for clarification,
    // return a safe fallback to prevent ungrounded answers.
    if (evidence.hitCount === 0 && !llmOutput.needs_clarification) {
      return NextResponse.json(fallbackChatResponse(requestId));
    }

    const response = buildChatResponse(llmOutput, evidence, requestId);
    return NextResponse.json(response);
  } catch (err) {
    console.error('[/api/chat]', err);
    const apiErr: ApiError = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        request_id: requestId,
      },
    };
    return NextResponse.json(apiErr, { status: 500 });
  }
}
