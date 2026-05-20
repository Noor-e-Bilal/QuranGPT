import type { IEmbeddingFunction, Collection } from 'chromadb';
import { ChromaClient } from 'chromadb';
import { existsSync } from 'fs';

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000';
const COLLECTION_NAME = 'quran_v2';           // BGE-small (384-dim)
const BASE_COLLECTION_NAME = 'base_quran_v2'; // BGE-base (768-dim)
const CACHE_COLLECTION_NAME = 'question_cache_v2'; // Semantic cache (768-dim, BGE-base)

// BGE v1.5 requires this prefix on queries (not on stored documents)
const BGE_QUERY_PREFIX =
  'Represent this sentence for searching relevant passages: ';

let _client: ChromaClient | null = null;

type ExtractorFn = (text: string | string[], opts: Record<string, unknown>) => Promise<{ data: Float32Array }>;

// ECS mounts the HuggingFace model cache on EFS at this path.
// Locally the path doesn't exist — fall back to Xenova's default (.cache/ in node_modules).
const ECS_CACHE_DIR = '/root/.cache/huggingface';
const HF_CACHE_DIR = existsSync(ECS_CACHE_DIR) ? ECS_CACHE_DIR : undefined;

// Lazy-loaded singleton extractors — each model downloads once on first use
let _smallExtractorPromise: Promise<ExtractorFn> | null = null;
let _baseExtractorPromise: Promise<ExtractorFn> | null = null;

function getExtractor(): Promise<ExtractorFn> {
  if (!_smallExtractorPromise) {
    _smallExtractorPromise = import('@xenova/transformers').then(
      ({ pipeline, env }) => {
        env.useBrowserCache = false; // Node.js: use filesystem cache
        if (HF_CACHE_DIR) env.cacheDir = HF_CACHE_DIR;
        return pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5') as Promise<ExtractorFn>;
      }
    ).catch((err) => {
      _smallExtractorPromise = null; // allow retry on next call
      throw err;
    });
  }
  return _smallExtractorPromise;
}

function getBaseExtractor(): Promise<ExtractorFn> {
  if (!_baseExtractorPromise) {
    _baseExtractorPromise = import('@xenova/transformers').then(
      ({ pipeline, env }) => {
        env.useBrowserCache = false;
        if (HF_CACHE_DIR) env.cacheDir = HF_CACHE_DIR;
        return pipeline('feature-extraction', 'Xenova/bge-base-en-v1.5') as Promise<ExtractorFn>;
      }
    ).catch((err) => {
      _baseExtractorPromise = null; // allow retry on next call
      throw err;
    });
  }
  return _baseExtractorPromise;
}

// ── Embed micro-batching ───────────────────────────────────────────────────────
// Requests that arrive within the same event-loop phase (BATCH_WINDOW_MS = 0 → the
// next macrotask boundary) are coalesced into one ONNX forward pass.
//
// Why this works for concurrent HTTP traffic:
//   10 requests → all await Valkey (~2ms) → all Valkey promises resolve in one
//   TCP read → all continuations run in one event-loop turn → all call embed in
//   the same tick → one ONNX batch of 10 (≈120ms) instead of 10 serial calls
//   (≈1,000ms for the 10th user).
//
// Single-user: batch of 1 → identical to the old per-call path.

const SMALL_DIM = 384;
const BASE_DIM = 768;
const BATCH_WINDOW_MS = 0;

interface BatchEntry {
  text: string;
  resolve: (v: number[]) => void;
  reject: (err: unknown) => void;
}

let _smallBatchQueue: BatchEntry[] = [];
let _smallBatchTimer: ReturnType<typeof setTimeout> | null = null;
let _baseBatchQueue: BatchEntry[] = [];
let _baseBatchTimer: ReturnType<typeof setTimeout> | null = null;

async function _flushSmallBatch(): Promise<void> {
  const batch = _smallBatchQueue.splice(0);
  if (batch.length === 0) return;
  try {
    const extractor = await getExtractor();
    const output = await extractor(batch.map(b => b.text), { pooling: 'mean', normalize: true });
    batch.forEach((b, i) =>
      b.resolve(Array.from(output.data.slice(i * SMALL_DIM, (i + 1) * SMALL_DIM))),
    );
  } catch (err) {
    batch.forEach(b => b.reject(err));
  }
}

async function _flushBaseBatch(): Promise<void> {
  const batch = _baseBatchQueue.splice(0);
  if (batch.length === 0) return;
  try {
    const extractor = await getBaseExtractor();
    const output = await extractor(batch.map(b => b.text), { pooling: 'mean', normalize: true });
    batch.forEach((b, i) =>
      b.resolve(Array.from(output.data.slice(i * BASE_DIM, (i + 1) * BASE_DIM))),
    );
  } catch (err) {
    batch.forEach(b => b.reject(err));
  }
}

function embedQuery(text: string): Promise<number[]> {
  return new Promise<number[]>((resolve, reject) => {
    _smallBatchQueue.push({ text: BGE_QUERY_PREFIX + text, resolve, reject });
    if (!_smallBatchTimer) {
      _smallBatchTimer = setTimeout(() => { _smallBatchTimer = null; void _flushSmallBatch(); }, BATCH_WINDOW_MS);
    }
  });
}

function embedQueryBase(text: string): Promise<number[]> {
  return new Promise<number[]>((resolve, reject) => {
    _baseBatchQueue.push({ text: BGE_QUERY_PREFIX + text, resolve, reject });
    if (!_baseBatchTimer) {
      _baseBatchTimer = setTimeout(() => { _baseBatchTimer = null; void _flushBaseBatch(); }, BATCH_WINDOW_MS);
    }
  });
}

// Stub EF — we always pass pre-computed queryEmbeddings, so this is never called
const stubEF: IEmbeddingFunction = {
  generate: async (_texts: string[]): Promise<number[][]> => [],
};

function getClient(): ChromaClient {
  if (!_client) {
    _client = new ChromaClient({ path: CHROMA_URL });
  }
  return _client;
}

// ── Collection handle cache ────────────────────────────────────────────────────
// Avoids a ChromaDB network round-trip on every vector search (saves ~20-30ms).
// Uses promise-memo pattern so concurrent requests don't each fire duplicate fetches.
// Handles (and their promises) are evicted on query error so a ChromaDB restart is
// self-healing — the next request fires a fresh getCollection call.

let _smallCollHandle: Collection | null = null;
let _baseCollHandle: Collection | null = null;
let _cacheCollHandle: Collection | null = null;
let _smallCollPromise: Promise<Collection> | null = null;
let _baseCollPromise: Promise<Collection> | null = null;
let _cacheCollPromise: Promise<Collection> | null = null;

function _evictCollHandle(name: string): void {
  if (name === COLLECTION_NAME) {
    _smallCollHandle = null;
    _smallCollPromise = null;
  } else if (name === BASE_COLLECTION_NAME) {
    _baseCollHandle = null;
    _baseCollPromise = null;
  } else if (name === CACHE_COLLECTION_NAME) {
    _cacheCollHandle = null;
    _cacheCollPromise = null;
  }
}

async function _getCollHandle(name: string): Promise<Collection> {
  if (name === COLLECTION_NAME) {
    if (_smallCollHandle) return _smallCollHandle;
    if (!_smallCollPromise) {
      _smallCollPromise = getClient()
        .getCollection({ name, embeddingFunction: stubEF })
        .then((c) => { _smallCollHandle = c; _smallCollPromise = null; return c; })
        .catch((err) => { _smallCollPromise = null; throw err; });
    }
    return _smallCollPromise;
  }
  if (name === BASE_COLLECTION_NAME) {
    if (_baseCollHandle) return _baseCollHandle;
    if (!_baseCollPromise) {
      _baseCollPromise = getClient()
        .getCollection({ name, embeddingFunction: stubEF })
        .then((c) => { _baseCollHandle = c; _baseCollPromise = null; return c; })
        .catch((err) => { _baseCollPromise = null; throw err; });
    }
    return _baseCollPromise;
  }
  // Unknown collection — fetch without caching
  return getClient().getCollection({ name, embeddingFunction: stubEF });
}

export interface ChromaResult {
  reference: string;
  text: string;
  surah: number;
  ayah: number;
  distance: number;
}

async function _queryChroma(
  collectionName: string,
  embedFn: () => Promise<number[]>,
  topK: number,
): Promise<ChromaResult[]> {
  // Fetch cached collection handle and compute embedding in parallel
  const [collection, queryEmbedding] = await Promise.all([
    _getCollHandle(collectionName),
    embedFn(),
  ]);

  let results;
  try {
    results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
    });
  } catch {
    // Stale handle (ChromaDB restarted) — evict and return empty so caller degrades gracefully
    _evictCollHandle(collectionName);
    return [];
  }

  const ids = results.ids[0] ?? [];
  const distances = results.distances?.[0] ?? [];
  const metadatas = results.metadatas?.[0] ?? [];

  return ids.map((id, i) => {
    const meta = (metadatas[i] ?? {}) as Record<string, unknown>;
    return {
      reference: String(id),
      text: String(meta.text ?? ''),
      surah: Number(meta.surah ?? 0),
      ayah: Number(meta.ayah ?? 0),
      distance: distances[i] ?? 1,
    };
  });
}

/** Query the BGE-small collection (quran_v2, 384-dim). */
export async function queryCollection(
  text: string,
  topK = 20,
): Promise<ChromaResult[]> {
  return _queryChroma(COLLECTION_NAME, () => embedQuery(text), topK);
}

/** Query the BGE-base collection (base_quran_v2, 768-dim). Falls back to [] if collection missing. */
export async function queryCollectionBase(
  text: string,
  topK = 20,
): Promise<ChromaResult[]> {
  return _queryChroma(BASE_COLLECTION_NAME, () => embedQueryBase(text), topK);
}

export async function checkChromaHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${CHROMA_URL}/api/v2/heartbeat`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return true;
    const res1 = await fetch(`${CHROMA_URL}/api/v1/heartbeat`, {
      signal: AbortSignal.timeout(3000),
    });
    return res1.ok;
  } catch {
    return false;
  }
}

// ---------- Semantic question cache (L2) -----------------------------------

const SEMANTIC_CACHE_THRESHOLD = 0.85; // Minimum cosine similarity to consider a cache hit
const CACHE_MAX_ENTRIES = 2000;         // Soft cap — old entries are pruned on write

/** Encode a question for cache storage using BGE-base (768-dim). */
export async function embedCacheQuestion(text: string): Promise<number[]> {
  return embedQueryBase(text);
}

/**
 * Get (or create) the question_cache_v2 collection in ChromaDB.
 * Uses cosine space to match the BGE-base embedding space.
 * Promise-memo: concurrent callers share one getOrCreateCollection call.
 */
async function getCacheCollection(): Promise<Collection> {
  if (_cacheCollHandle) return _cacheCollHandle;
  if (!_cacheCollPromise) {
    _cacheCollPromise = getClient()
      .getOrCreateCollection({
        name: CACHE_COLLECTION_NAME,
        embeddingFunction: stubEF,
        metadata: { 'hnsw:space': 'cosine' },
      })
      .then((c) => { _cacheCollHandle = c; _cacheCollPromise = null; return c; })
      .catch((err) => { _cacheCollPromise = null; throw err; });
  }
  return _cacheCollPromise;
}

export interface CacheQueryResult {
  /** The serialised ChatResponse JSON that was stored. */
  answerJson: string;
  /** The original question text that was cached. */
  question: string;
  /** Cosine similarity [0..1]. */
  similarity: number;
}

/**
 * Store a question+answer pair in the semantic cache.
 * If the collection already has CACHE_MAX_ENTRIES, the oldest entry is deleted first.
 * Fire-and-forget safe — errors are caught and logged, never rethrow.
 */
export async function storeCacheEntry(
  questionNorm: string,
  embedding: number[],
  answerJson: string,
): Promise<void> {
  try {
    const col = await getCacheCollection();
    const count = await col.count();
    if (count >= CACHE_MAX_ENTRIES) {
      // Evict the oldest entry by peeking one item
      const peek = await col.peek({ limit: 1 });
      if (peek.ids.length > 0) await col.delete({ ids: [peek.ids[0]] });
    }
    // Use a deterministic ID so duplicate questions overwrite, not duplicate
    const id = Buffer.from(questionNorm).toString('base64').slice(0, 128);
    await col.upsert({
      ids: [id],
      embeddings: [embedding],
      metadatas: [{ question: questionNorm, answer: answerJson, ts: Date.now() }],
      documents: [questionNorm],
    });
  } catch (err) {
    _cacheCollHandle = null; // evict stale handle so next call gets a fresh one
    console.warn('[cache] storeCacheEntry failed (non-fatal):', err);
  }
}

/**
 * Delete all entries from the semantic cache collection in ChromaDB.
 * Used by the cache-clear API to evict stale low/medium-confidence entries.
 */
export async function clearCacheCollection(): Promise<void> {
  try {
    const col = await getCacheCollection();
    const count = await col.count();
    if (count === 0) return;
    const peek = await col.peek({ limit: count });
    if (peek.ids.length > 0) await col.delete({ ids: peek.ids });
    // Evict the cached handle so the next lookup gets a fresh count
    _cacheCollHandle = null;
    _cacheCollPromise = null;
  } catch (err) {
    console.warn('[cache] clearCacheCollection failed:', err);
  }
}

/**
 * Query the semantic cache. Returns the best match if similarity ≥ threshold.
 * Returns null on cache miss or any ChromaDB error.
 */
export async function queryCacheEntry(
  embedding: number[],
  threshold = SEMANTIC_CACHE_THRESHOLD,
): Promise<CacheQueryResult | null> {
  try {
    const col = await getCacheCollection();
    const count = await col.count();
    if (count === 0) return null;

    const results = await col.query({
      queryEmbeddings: [embedding],
      nResults: 1,
    });

    const distance = results.distances?.[0]?.[0];
    if (distance === undefined || distance === null) return null;

    // ChromaDB cosine space: distance = 1 - dot_product → range [0, 2]
    const similarity = Math.max(0, 1 - distance / 2);
    if (similarity < threshold) return null;

    const meta = (results.metadatas?.[0]?.[0] ?? {}) as Record<string, unknown>;
    const answerJson = String(meta.answer ?? '');
    const question = String(meta.question ?? '');
    if (!answerJson) return null;

    return { answerJson, question, similarity };
  } catch (err) {
    _cacheCollHandle = null; // evict stale handle so next call gets a fresh one
    console.warn('[cache] queryCacheEntry failed (non-fatal):', err);
    return null;
  }
}

