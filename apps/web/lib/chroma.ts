import type { IEmbeddingFunction } from 'chromadb';
import { ChromaClient } from 'chromadb';

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000';
const COLLECTION_NAME = 'quran_v2';

// BGE v1.5 requires this prefix on queries (not on stored documents)
const BGE_QUERY_PREFIX =
  'Represent this sentence for searching relevant passages: ';

let _client: ChromaClient | null = null;

// Lazy-loaded singleton extractor — model downloads once on first use (~130MB)
let _extractorPromise: Promise<(text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>> | null = null;

function getExtractor() {
  if (!_extractorPromise) {
    _extractorPromise = import('@xenova/transformers').then(
      ({ pipeline, env }) => {
        env.useBrowserCache = false; // Node.js: use filesystem cache
        return pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5') as Promise<
          (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>
        >;
      }
    );
  }
  return _extractorPromise;
}

async function embedQuery(text: string): Promise<number[]> {
  const extractor = await getExtractor();
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

export async function queryCollection(
  text: string,
  topK = 20
): Promise<ChromaResult[]> {
  const [collection, queryEmbedding] = await Promise.all([
    getClient().getCollection({ name: COLLECTION_NAME, embeddingFunction: stubEF }),
    embedQuery(text),
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

