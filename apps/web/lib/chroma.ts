import type { IEmbeddingFunction } from 'chromadb';
import { ChromaClient } from 'chromadb';

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000';
const COLLECTION_NAME = 'quran_v2';         // BGE-small (384-dim)
const BASE_COLLECTION_NAME = 'base_quran_v2'; // BGE-base (768-dim)

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

