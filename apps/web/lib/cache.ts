/**
 * Two-tier semantic cache for LLM responses.
 *
 * L1 — Valkey (Redis-compatible) KV store: exact normalised-key lookup, ~1-5ms.
 *       Set via VALKEY_URL env var. TTL and LRU eviction are handled server-side
 *       (maxmemory-policy allkeys-lru). Survives Next.js process restarts.
 *       Falls back to in-memory LruTtlCache when Valkey is unavailable.
 *
 * L2 — ChromaDB SemanticCache: embedding similarity lookup (BGE-base, 768-dim).
 *       Catches paraphrases. Returns a hit when cosine similarity >= SEMANTIC_CACHE_THRESHOLD (0.90).
 *
 * Every lookup returns a CacheLookupResult describing the strategy used, so the
 * debug panel can compare exact vs semantic vs miss across pipelines.
 *
 * Note on cosine formula: ChromaDB cosine space returns distance ∈ [0, 2], so
 * similarity = 1 - distance/2 correctly maps to [0, 1].
 */

import type { CacheInfo } from './types';
import {
  embedCacheQuestion,
  storeCacheEntry,
  queryCacheEntry,
} from './chroma';
import Redis from 'ioredis';

// ── Configuration ─────────────────────────────────────────────────────────────
const TTL_MS = 24 * 60 * 60 * 1_000;   // 24h — in-memory fallback
const TTL_SEC = 24 * 60 * 60;           // 24h — Valkey SETEX
const MAX_ENTRIES = 1_000;              // in-memory fallback capacity
const VALKEY_KEY_PREFIX = 'qs:cache:';
const VALKEY_CMD_TIMEOUT_MS = 200;      // fail-fast; never block a response

// ── In-memory LRU+TTL fallback ─────────────────────────────────────────────────
// Used when VALKEY_URL is not set (local dev) or Valkey is unreachable.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class LruTtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Promote to tail (most-recently-used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.map.delete(key);
    if (this.map.size >= MAX_ENTRIES) {
      const lruKey = this.map.keys().next().value;
      if (lruKey !== undefined) this.map.delete(lruKey);
    }
    this.map.set(key, { value, expiresAt: Date.now() + TTL_MS });
  }

  get size(): number {
    return this.map.size;
  }
}

// Singleton — kept alive across requests in the same Next.js process
const _memCache = new LruTtlCache<object>();

// Backward-compat export for any direct callers
export const chatCache = _memCache;

// ── Valkey client ──────────────────────────────────────────────────────────────

let _valkeyClient: Redis | null = null;

function getValkeyClient(): Redis | null {
  const url = process.env.VALKEY_URL;
  if (!url) return null;
  if (_valkeyClient) return _valkeyClient;

  _valkeyClient = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 0,    // fail fast per command — fallback to in-memory
    enableOfflineQueue: false,  // reject commands immediately when disconnected
    connectTimeout: 1_000,
    commandTimeout: VALKEY_CMD_TIMEOUT_MS,
  });

  // Suppress unhandled error events — failures are handled at call sites
  _valkeyClient.on('error', () => {});

  return _valkeyClient;
}

async function valkeyGet(key: string): Promise<object | null> {
  const client = getValkeyClient();
  if (!client) return null;
  try {
    const raw = await client.get(VALKEY_KEY_PREFIX + key);
    return raw ? (JSON.parse(raw) as object) : null;
  } catch {
    return null;
  }
}

function valkeySet(key: string, value: object): void {
  const client = getValkeyClient();
  if (!client) return;
  // Fire-and-forget — cache write never delays a response
  client.setex(VALKEY_KEY_PREFIX + key, TTL_SEC, JSON.stringify(value)).catch(() => {});
}

// ── Normalisation ──────────────────────────────────────────────────────────────

export function normaliseCacheKey(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Two-tier lookup result ─────────────────────────────────────────────────────

export interface CacheLookupResult {
  /** The cached response object, or null on miss. */
  value: object | null;
  /** Describes which strategy resolved the lookup. */
  cacheInfo: CacheInfo;
}

/**
 * Look up a question in both cache tiers.
 *
 * L1a: in-memory LRU (sync, ~0ms) — fastest path, checked first.
 * L1b: Valkey GET (exact, ~2ms) — checked on in-memory miss; critical after process restart.
 *      Valkey hit also promotes to in-memory to short-circuit future lookups.
 * L2:  ChromaDB vector similarity on L1 miss (~120-175ms with BGE-base).
 * Returns a miss descriptor if neither tier has a match.
 *
 * Safe to call always — all errors degrade gracefully, never throw.
 */
export async function lookupCache(question: string): Promise<CacheLookupResult> {
  const key = normaliseCacheKey(question);

  // L1a: in-memory (sync, ~0ms) — fastest path; always check first
  const memHit = _memCache.get(key);
  if (memHit) {
    return { value: memHit, cacheInfo: { strategy: 'exact' } };
  }

  // L1b: Valkey exact lookup (~2ms on hit; needed after process restarts)
  const valkeyHit = await valkeyGet(key);
  if (valkeyHit) {
    // Promote back to in-memory so subsequent requests skip Valkey
    _memCache.set(key, valkeyHit);
    return { value: valkeyHit, cacheInfo: { strategy: 'exact' } };
  }

  // L2: semantic similarity via ChromaDB
  try {
    const embedding = await embedCacheQuestion(key);
    const hit = await queryCacheEntry(embedding);
    if (hit) {
      const parsed = JSON.parse(hit.answerJson) as object;
      // Promote L2 hit to L1 so the next identical request is O(1)
      valkeySet(key, parsed);
      _memCache.set(key, parsed);
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
 * L1 (Valkey + in-memory) is fire-and-forget; L2 (ChromaDB) is fire-and-forget.
 * Never blocks — the response has already been sent when this is called.
 */
export function storeCache(question: string, value: object): void {
  const key = normaliseCacheKey(question);

  // L1 — Valkey (primary) and in-memory (fallback)
  valkeySet(key, value);
  _memCache.set(key, value);

  // L2 — async, fire-and-forget
  embedCacheQuestion(key)
    .then((embedding) => storeCacheEntry(key, embedding, JSON.stringify(value)))
    .catch(() => { /* non-fatal */ });
}

