import { ChromaClient } from 'chromadb';
import type { IEmbeddingFunction } from 'chromadb';

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000';
const COLLECTION_NAME = 'quran_v1';

let _client: ChromaClient | null = null;

// Server-side embedding function — never called because we use queryTexts
// (ChromaDB server handles embeddings via its built-in ONNX function)
const serverEF: IEmbeddingFunction = {
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
  const collection = await getClient().getCollection({
    name: COLLECTION_NAME,
    embeddingFunction: serverEF,
  });
  const results = await collection.query({
    queryTexts: [text],
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
    // Try v2 API first (chromadb >= 0.6), fall back to v1
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
