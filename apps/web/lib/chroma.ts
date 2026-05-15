import type { IEmbeddingFunction } from 'chromadb';
import { ChromaClient } from 'chromadb';

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000';
const COLLECTION_NAME = 'quran_v2';         // BGE-small (384-dim)
const BASE_COLLECTION_NAME = 'base_quran_v2'; // BGE-base (768-dim)
const CACHE_COLLECTION_NAME = 'question_cache'; // Semantic cache (384-dim, BGE-small)

// BGE v1.5 requires this prefix on queries (not on stored documents)
const BGE_QUERY_PREFIX =
  'Represent this sentence for searching relevant passages: ';

let _client: ChromaClient | null = null;

type ExtractorFn = (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>;

// Lazy-loaded singleton extractors — each model downloads once on first use
let _smallExtractorPromise: Promise<ExtractorFn> | null = null;
let _baseExtractorPromise: Promise<ExtractorFn> | null = null;

function getExtractor(): Promise<ExtractorFn> {
  if (!_smallExtractorPromise) {
    _smallExtractorPromise = import('@xenova/transformers').then(
      ({ pipeline, env }) => {
        env.useBrowserCache = false; // Node.js: use filesystem cache
        env.cacheDir = '/root/.cache/huggingface'; // must match EFS mount in ecs.tf
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
        env.cacheDir = '/root/.cache/huggingface'; // must match EFS mount in ecs.tf
        return pipeline('feature-extraction', 'Xenova/bge-base-en-v1.5') as Promise<ExtractorFn>;
      }
    ).catch((err) => {
      _baseExtractorPromise = null; // allow retry on next call
      throw err;
    });
  }
  return _baseExtractorPromise;
}

async function embedQuery(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(BGE_QUERY_PREFIX + text, {
    pooling: 'mean',
    normalize: true,
  });
  return Array.from(output.data);
}

async function embedQueryBase(text: string): Promise<number[]> {
  const extractor = await getBaseExtractor();
  const output = await extractor(BGE_QUERY_PREFIX + text, {
    pooling: 'mean',
    normalize: true,
  });
  return Array.from(output.data);
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
  // Fetch collection and compute embedding in parallel
  const [collection, queryEmbedding] = await Promise.all([
    getClient().getCollection({ name: collectionName, embeddingFunction: stubEF }),
    embedFn(),
  ]);

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: topK,
  });

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

const SEMANTIC_CACHE_THRESHOLD = 0.90; // Minimum cosine similarity to consider a cache hit
const CACHE_MAX_ENTRIES = 2000;         // Soft cap — old entries are pruned on write

/** Encode a question for cache storage (same prefix as query embeddings). */
export async function embedCacheQuestion(text: string): Promise<number[]> {
  return embedQuery(text);
}

/**
 * Get (or create) the question_cache collection in ChromaDB.
 * Uses cosine space to match the BGE-small embedding space.
 */
async function getCacheCollection() {
  return getClient().getOrCreateCollection({
    name: CACHE_COLLECTION_NAME,
    embeddingFunction: stubEF,
    metadata: { 'hnsw:space': 'cosine' },
  });
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
    console.warn('[cache] storeCacheEntry failed (non-fatal):', err);
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
    console.warn('[cache] queryCacheEntry failed (non-fatal):', err);
    return null;
  }
}

