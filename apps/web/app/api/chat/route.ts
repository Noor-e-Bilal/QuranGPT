import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { retrieve } from '@/lib/retrieval';
import { generateChatResponse, generateClarificationQuestion } from '@/lib/llm';
import { buildChatResponse, fallbackChatResponse } from '@/lib/validator';
import { chatCache, normaliseCacheKey } from '@/lib/cache';
import type { ApiError } from '@/lib/types';

// Simple in-memory rate limiter: 10 req/min per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const WINDOW_MS = 60_000;
// After this many clarification rounds, activate safety valve (present best answer)
const MAX_CLARIFICATION_ROUNDS = 3;

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

/**
 * Count how many "[User clarified:" markers are in the question string.
 * Each marker represents one completed clarification round.
 */
function parseClarificationRound(question: string): number {
  return (question.match(/\[User clarified:/g) ?? []).length;
}

/**
 * Build an enriched query by stripping the "[User clarified: ...]" markers
 * and combining core question + clarification text into one search string.
 * This gives retrieval a richer signal after multiple turns.
 */
function buildEnrichedQuery(question: string): string {
  return question
    .replace(/\[User clarified:\s*/g, ' ')
    .replace(/\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    const clarificationRound = parseClarificationRound(question);
    const isClarificationTurn = clarificationRound > 0;

    // Cache: only for original (non-clarification) questions
    if (!isClarificationTurn) {
      const cached = chatCache.get(normaliseCacheKey(question));
      if (cached) {
        return NextResponse.json({ ...cached, request_id: requestId, cached: true });
      }
    }

    // Use enriched query (strips markers, combines context) for better retrieval
    const enrichedQuery = buildEnrichedQuery(question);
    const evidence = await retrieve(enrichedQuery);

    // ── Confidence gating ────────────────────────────────────────────────
    // Safety valve: after MAX_CLARIFICATION_ROUNDS, answer with whatever we have
    const safetyValve =
      clarificationRound >= MAX_CLARIFICATION_ROUNDS && evidence.confidence !== 'high';

    if (evidence.confidence !== 'high' && !safetyValve) {
      // Not enough evidence yet — ask a targeted clarification question
      const clarifyOutput = await generateClarificationQuestion(
        question,
        evidence,
        evidence.confidence
      );
      // Clarification responses are never cached
      return NextResponse.json(buildChatResponse(clarifyOutput, evidence, requestId));
    }

    // ── Answer path (HIGH confidence OR safety valve) ─────────────────────
    const llmOutput = await generateChatResponse(question, evidence, safetyValve);

    // Guard: if retrieval found nothing and LLM isn't requesting clarification,
    // return safe fallback to prevent ungrounded answers.
    if (evidence.hitCount === 0 && !llmOutput.needs_clarification) {
      return NextResponse.json(fallbackChatResponse(requestId));
    }

    const response = buildChatResponse(llmOutput, evidence, requestId);

    // Only cache HIGH-confidence answers for original questions
    if (!isClarificationTurn && evidence.confidence === 'high' && !llmOutput.needs_clarification) {
      chatCache.set(normaliseCacheKey(question), response);
    }

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
