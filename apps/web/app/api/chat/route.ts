import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { retrieve } from '@/lib/retrieval';
import { generateChatResponse, generateClarificationQuestion } from '@/lib/llm';
import { buildChatResponse, fallbackChatResponse, maxRoundsDeclineResponse } from '@/lib/validator';
import { lookupCache, storeCache } from '@/lib/cache';
import type { ApiError, CacheInfo, DebugInfo, ProviderSettings } from '@/lib/types';

const IS_DEV = process.env.NODE_ENV === 'development';

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

  let body: { question?: unknown; providerSettings?: unknown; reformulated_query?: unknown };
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

  // Optional: pre-reformulated query from /api/reformulate two-step flow
  const reformulatedQuery =
    typeof body.reformulated_query === 'string' && body.reformulated_query.trim()
      ? body.reformulated_query.trim()
      : undefined;

  // Optional: provider/model/temperature settings from UI
  const providerSettings = isProviderSettings(body.providerSettings)
    ? body.providerSettings
    : undefined;


  try {
    const clarificationRound = parseClarificationRound(question);
    const isClarificationTurn = clarificationRound > 0;

    // Two-tier cache: only for original (non-clarification) questions
    let cacheInfo: CacheInfo = { strategy: 'miss' };
    if (!isClarificationTurn) {
      // Try original question first
      const { value, cacheInfo: info } = await lookupCache(question);
      // Guard: reject upgrade-pipeline cache entries (label='Upgrade') that leak
      // into chat via semantic search (ChromaDB has no namespace filter).
      if (value && (value as Record<string, unknown>).label !== 'Upgrade') {
        cacheInfo = info;
        return NextResponse.json({ ...value, request_id: requestId, cache_info: cacheInfo });
      }
      // On miss, also try the reformulated query — same concept, different phrasing
      // hits the cache if reformulation produced similar keywords.
      if (reformulatedQuery && reformulatedQuery !== question) {
        const { value: rVal, cacheInfo: rInfo } = await lookupCache(reformulatedQuery);
        if (rVal && (rVal as Record<string, unknown>).label !== 'Upgrade') {
          cacheInfo = rInfo;
          return NextResponse.json({ ...rVal, request_id: requestId, cache_info: cacheInfo });
        }
      }
      // If we got a hit but it was an upgrade entry, treat it as a miss
    }

    // Use enriched query (strips markers, combines context) for better retrieval.
    // If client sent a pre-reformulated query from /api/reformulate, use it directly.
    const enrichedQuery = buildEnrichedQuery(question);
    const retrievalQuery = reformulatedQuery ?? enrichedQuery;
    const evidence = await retrieve(retrievalQuery);

    // ── Confidence gating ────────────────────────────────────────────────
    // Only high-confidence retrievals produce an answer.
    // medium/low → ask clarifying questions until MAX_CLARIFICATION_ROUNDS,
    // then decline gracefully rather than force a low-quality answer.
    if (evidence.confidence !== 'high') {
      if (clarificationRound >= MAX_CLARIFICATION_ROUNDS) {
        const decline = maxRoundsDeclineResponse(requestId);
        decline.cache_info = { strategy: 'miss' };
        return NextResponse.json(decline);
      }

      const clarifyOutput = await generateClarificationQuestion(
        question,
        evidence,
        evidence.confidence,
        providerSettings,
      );
      const clarifyResponse = buildChatResponse(clarifyOutput, evidence, requestId);
      clarifyResponse.cache_info = { strategy: 'miss' };
      if (IS_DEV && clarifyOutput._debug && evidence._debug) {
        const debug: DebugInfo = {
          timestamp: new Date().toISOString(),
          original_question: question,
          reformulated_query: reformulatedQuery,
          enriched_query: enrichedQuery,
          clarification_round: clarificationRound,
          safety_valve: false,
          cache_hit: false,
          cache_info: { strategy: 'miss' },
          provider_settings: providerSettings
            ? { provider: providerSettings.provider, model: providerSettings.model }
            : undefined,
          retrieval: evidence._debug,
          llm: clarifyOutput._debug,
        };
        clarifyResponse.debug = debug;
      }
      return NextResponse.json(clarifyResponse);
    }

    // ── Answer path (HIGH confidence only) ───────────────────────────────
    const llmOutput = await generateChatResponse(question, evidence, false, providerSettings);

    if (evidence.hitCount === 0 && !llmOutput.needs_clarification) {
      return NextResponse.json(fallbackChatResponse(requestId));
    }

    const response = buildChatResponse(llmOutput, evidence, requestId);

    // Guard: if citation validation stripped all citations and downgraded confidence,
    // treat as fallback rather than return a low-quality answer without signal.
    if (response.confidence !== 'high') {
      return NextResponse.json(fallbackChatResponse(requestId));
    }

    // Attach reformulated query so UI can show "searched for: ..."
    if (reformulatedQuery) {
      response.reformulated_query = reformulatedQuery;
    }

    if (!isClarificationTurn && !llmOutput.needs_clarification) {
      storeCache(question, { ...response });
      // Also cache under the reformulated query so different phrasings of the same
      // concept get exact-match cache hits after the first miss.
      if (reformulatedQuery && reformulatedQuery !== question) {
        storeCache(reformulatedQuery, { ...response });
      }
    }

    if (IS_DEV && llmOutput._debug && evidence._debug) {
      const debug: DebugInfo = {
        timestamp: new Date().toISOString(),
        original_question: question,
        reformulated_query: reformulatedQuery,
        enriched_query: enrichedQuery,
        clarification_round: clarificationRound,
        safety_valve: false,
        cache_hit: false,
        cache_info: cacheInfo,
        provider_settings: providerSettings
          ? { provider: providerSettings.provider, model: providerSettings.model }
          : undefined,
        retrieval: evidence._debug,
        llm: llmOutput._debug,
      };
      response.debug = debug;
    }

    // Always include cache_info in the response
    response.cache_info = cacheInfo;
    return NextResponse.json(response);
  } catch (err) {
    console.error('[/api/chat]', err);
    // Anthropic SDK throws with .status = 429 on rate limit
    const status = (err as Record<string, unknown>)?.status;
    if (status === 429) {
      const apiErr: ApiError = {
        error: { code: 'RATE_LIMITED', message: 'LLM API rate limit reached — please wait a moment and try again.', request_id: requestId },
      };
      return NextResponse.json(apiErr, { status: 503 });
    }
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
