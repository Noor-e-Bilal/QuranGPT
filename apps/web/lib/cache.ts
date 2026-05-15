/**
 * Two-tier semantic cache for LLM responses.
 *
 * L1 — In-memory TtlCache: exact normalised-key lookup. O(1), ~5 min TTL.
 * L2 — ChromaDB SemanticCache: embedding similarity lookup. Catches paraphrases.
 *       Returns a hit when cosine similarity >= SEMANTIC_CACHE_THRESHOLD (default 0.90).
 *
 * Every lookup returns a CacheLookupResult describing the strategy used, so the
 * debug panel can compare exact vs semantic vs miss across pipelines.
 */

import type { CacheInfo } from './types';
import {
  embedCacheQuestion,
  storeCacheEntry,
  queryCacheEntry,
} from './chroma';

const TTL_MS = 5 * 60 * 1_000; // 5 minutes
const MAX_ENTRIES = 500;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.map.size >= MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + TTL_MS });
  }
}

// Singleton — Next.js module cache keeps this alive across requests
export const chatCache = new TtlCache<object>();

/** Normalise a question for use as cache key. */
export function normaliseCacheKey(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------- Two-tier lookup result ------------------------------------------

export interface CacheLookupResult {
  /** The cached response object, or null on miss. */
  value: object | null;
  /** Describes which strategy resolved the lookup. */
  cacheInfo: CacheInfo;
}

/**
 * Look up a question in both cache tiers.
 *
 * Returns immediately on L1 hit (no embedding cost).
 * Falls through to L2 (ChromaDB vector search) on L1 miss.
 * Returns a miss descriptor if neither tier has a match.
 *
 * Safe to call always — L2 errors degrade to miss, never throw.
 */
export async function lookupCache(question: string): Promise<CacheLookupResult> {
  const key = normaliseCacheKey(question);

  // L1: exact in-memory
  const l1 = chatCache.get(key);
  if (l1) {
    return { value: l1, cacheInfo: { strategy: 'exact' } };
  }

  // L2: semantic similarity via ChromaDB
  try {
    const embedding = await embedCacheQuestion(key);
    const hit = await queryCacheEntry(embedding);
    if (hit) {
      const parsed = JSON.parse(hit.answerJson) as object;
      // Promote to L1 so the next identical request is O(1)
      chatCache.set(key, parsed);
      return {
        value: parsed,
        cacheInfo: {
          strategy: 'semantic',
          similarity: Math.round(hit.similarity * 1000) / 1000,
          matched_question: hit.question,
        },
      };
    }
  } catch {
    // L2 unavailable — degrade to miss silently
  }

  return { value: null, cacheInfo: { strategy: 'miss' } };
}

/**
 * Store an answer in both cache tiers.
 * L1 is synchronous; L2 (ChromaDB) is fire-and-forget.
 */
export function storeCache(question: string, value: object): void {
  const key = normaliseCacheKey(question);

  // L1 — synchronous
  chatCache.set(key, value);

  // L2 — async, fire-and-forget
  embedCacheQuestion(key)
    .then((embedding) => storeCacheEntry(key, embedding, JSON.stringify(value)))
    .catch(() => { /* non-fatal */ });
}
