import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { retrieveRRF } from '@/lib/retrieval';
import { generateChatResponse } from '@/lib/llm';
import { buildChatResponse } from '@/lib/validator';
import type { ApiError, ProviderSettings, ComparePanelResult } from '@/lib/types';

// Mirrors the rate limiter in /api/chat (10 req/min per IP)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    // Evict expired entries on each new window creation to prevent unbounded growth
    for (const [k, v] of rateLimitMap) {
      if (now >= v.resetAt) rateLimitMap.delete(k);
    }
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

/** Strip "[User clarified: ...]" markers and normalise whitespace for cleaner retrieval. */
function buildRetrievalQuery(question: string): string {
  return question
    .replace(/\[User clarified:\s*/g, ' ')
    .replace(/\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isProviderSettings(v: unknown): v is ProviderSettings {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    (p.provider === 'opencode' || p.provider === 'claude' || p.provider === 'openai' || p.provider === 'openrouter') &&
    typeof p.model === 'string' &&
    p.model.length > 0 &&
    typeof p.temperature === 'number'
  );
}

/**
 * POST /api/compare
 * Runs the upgrade pipeline (BGE-base + RRF) and generates a full LLM answer.
 * Returns a ComparePanelResult for the right-side panel in comparison mode.
 */
export async function POST(req: NextRequest) {
  const requestId = uuidv4();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1';

  if (!checkRateLimit(ip)) {
    const err: ApiError = {
      error: { code: 'RATE_LIMITED', message: 'Too many requests.', request_id: requestId },
    };
    return NextResponse.json(err, { status: 429 });
  }

  let body: { question?: unknown; reformulated_query?: unknown; providerSettings?: unknown };
  try {
    body = await req.json();
  } catch {
    const err: ApiError = {
      error: { code: 'BAD_REQUEST', message: 'Request body must be JSON.', request_id: requestId },
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

  const reformulatedQuery =
    typeof body.reformulated_query === 'string' && body.reformulated_query.trim()
      ? body.reformulated_query.trim()
      : undefined;

  const providerSettings = isProviderSettings(body.providerSettings)
    ? body.providerSettings
    : undefined;

  const retrievalQuery = reformulatedQuery ?? buildRetrievalQuery(question);

  try {
    // Upgrade pipeline: BGE-base embeddings + Reciprocal Rank Fusion
    const { bundle } = await retrieveRRF(retrievalQuery);

    // safetyValve=true forces an answer — prevents blank right panel from clarification responses
    const llmOutput = await generateChatResponse(question, bundle, true, providerSettings);
    const chatResponse = buildChatResponse(llmOutput, bundle, requestId);

    const result: ComparePanelResult = {
      label: 'Upgrade',
      formula: 'BGE-base · RRF',
      answer: chatResponse.answer,
      summary: chatResponse.summary,
      citations: chatResponse.citations,
      limitations: chatResponse.limitations,
      confidence: chatResponse.confidence,
      source_policy: chatResponse.source_policy,
      reformulated_query: reformulatedQuery,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/compare] error:', err);
    const apiErr: ApiError = {
      error: { code: 'INTERNAL_ERROR', message: 'Comparison pipeline failed.', request_id: requestId },
    };
    return NextResponse.json(apiErr, { status: 500 });
  }
}
