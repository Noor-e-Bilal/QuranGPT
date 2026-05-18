import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { retrieveRRF } from '@/lib/retrieval';
import { generateChatResponse } from '@/lib/llm';
import { buildChatResponse } from '@/lib/validator';
import { normaliseCacheKey } from '@/lib/cache';
import type { ApiError, ProviderSettings, ComparePanelResult, UpgradeDebugInfo, CacheInfo } from '@/lib/types';

const IS_DEV = process.env.NODE_ENV === 'development';
const BASE_EMBEDDING_MODEL = 'BAAI/bge-base-en-v1.5';

// ── In-process LRU cache for upgrade pipeline results ─────────────────────────
// Separate from the chat cache — upgrade answers differ (BGE-base + RRF retrieval).
// In-memory only; no ChromaDB/Valkey needed for a developer debug tool.
const _upgradeCache = new Map<string, ComparePanelResult>();
const UPGRADE_CACHE_MAX = 200;

function upgradeCacheLookup(key: string): ComparePanelResult | null {
  const hit = _upgradeCache.get(key);
  if (!hit) return null;
  // Promote to tail (LRU)
  _upgradeCache.delete(key);
  _upgradeCache.set(key, hit);
  return hit;
}

function upgradeCacheStore(key: string, value: ComparePanelResult): void {
  if (_upgradeCache.size >= UPGRADE_CACHE_MAX) {
    const lruKey = _upgradeCache.keys().next().value;
    if (lruKey !== undefined) _upgradeCache.delete(lruKey);
  }
  _upgradeCache.set(key, value);
}

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

  // ── Upgrade cache lookup ────────────────────────────────────────────────────
  // Key includes retrievalQuery (post-reformulation) + provider/model so different
  // settings or reformulations don't collide on the same raw question.
  const providerKey = providerSettings
    ? `${providerSettings.provider}|${providerSettings.model}`
    : 'default';
  const cacheKey = `${normaliseCacheKey(retrievalQuery)}|${providerKey}`;
  const cachedResult = upgradeCacheLookup(cacheKey);
  if (cachedResult) {
    const cacheInfo: CacheInfo = { strategy: 'exact' };
    return NextResponse.json({ ...cachedResult, cache_info: cacheInfo, request_id: requestId });
  }

  try {
    // Upgrade pipeline: BGE-base embeddings + Reciprocal Rank Fusion
    const { bundle, rrfScores } = await retrieveRRF(retrievalQuery);

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
      cache_info: { strategy: 'miss' },
    };

    if (IS_DEV && llmOutput._debug) {
      const upgradeDebug: UpgradeDebugInfo = {
        retrieval: {
          query_used: retrievalQuery,
          embedding_model: BASE_EMBEDDING_MODEL,
          fts_hits: rrfScores.filter((s) => s.rank_fts > 0).length,
          semantic_hits: rrfScores.filter((s) => s.rank_semantic > 0).length,
          confidence: bundle.confidence,
          rrf_scores: rrfScores,
        },
        llm: llmOutput._debug,
      };
      result.debug = upgradeDebug;
    }

    // Store clean copy (no debug, no cache_info) so cache hits are lean
    upgradeCacheStore(cacheKey, {
      label: result.label,
      formula: result.formula,
      answer: result.answer,
      summary: result.summary,
      citations: result.citations,
      limitations: result.limitations,
      confidence: result.confidence,
      source_policy: result.source_policy,
      reformulated_query: result.reformulated_query,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/compare] error:', err);
    // Anthropic SDK throws with .status = 429 on rate limit
    const status = (err as Record<string, unknown>)?.status;
    if (status === 429) {
      const apiErr: ApiError = {
        error: { code: 'RATE_LIMITED', message: 'LLM API rate limit reached — please wait a moment and try again.', request_id: requestId },
      };
      return NextResponse.json(apiErr, { status: 503 });
    }
    const apiErr: ApiError = {
      error: { code: 'INTERNAL_ERROR', message: 'Comparison pipeline failed.', request_id: requestId },
    };
    return NextResponse.json(apiErr, { status: 500 });
  }
}
