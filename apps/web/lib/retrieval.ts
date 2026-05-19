import { searchFTS, getAyahsByReferences, expandQueryForSemantic } from './db';
import { queryCollection, queryCollectionBase } from './chroma';
import type {
  EvidenceAyah,
  EvidenceBundle,
  RetrievalConfidence,
  RetrievalDebugScore,
  RRFScoreRow,
} from './types';

const FTS_WEIGHT = 0.4;
const SEMANTIC_WEIGHT = 0.6;
const SCORE_THRESHOLD = 0.15;   // Minimum score to include a hit
const TOP_K = 10;
const EMBEDDING_MODEL = 'BAAI/bge-small-en-v1.5';
const BASE_EMBEDDING_MODEL = 'BAAI/bge-base-en-v1.5';

// Tiered confidence thresholds (calibrated for BGE cosine similarity scores)
// HIGH_SCORE is set low enough that a strong FTS-only match qualifies when
// ChromaDB doesn't return the same ayah (FTS-only max combined = 1.0 * 0.4 = 0.40).
const HIGH_SCORE = 0.38;   // Strong evidence: top FTS match or FTS+semantic overlap
const MEDIUM_SCORE = 0.20; // Partial evidence: related but not precise

function classifyConfidence(ayahs: EvidenceAyah[]): RetrievalConfidence {
  if (ayahs.length === 0) return 'none';
  const topScore = ayahs[0].score; // sorted descending
  if (topScore >= HIGH_SCORE) return 'high';
  if (topScore >= MEDIUM_SCORE) return 'medium';
  return 'low';
}

export async function retrieve(query: string): Promise<EvidenceBundle> {
  const expandedQuery = expandQueryForSemantic(query);
  const [ftsRows, chromaRows] = await Promise.all([
    Promise.resolve(searchFTS(query, 20)),
    queryCollection(expandedQuery, 20).catch(() => []),
  ]);

  const rawScores = new Map<string, { fts: number; semantic: number }>();

  // FTS rank: position-based score (0..1, best rank = 1)
  ftsRows.forEach((row, idx) => {
    const score = 1 - idx / Math.max(ftsRows.length, 1);
    rawScores.set(row.reference, { fts: score, semantic: 0 });
  });

  // Semantic score: 1 - distance (ChromaDB returns cosine distance 0..2)
  chromaRows.forEach((row) => {
    const score = Math.max(0, 1 - row.distance / 2);
    const existing = rawScores.get(row.reference);
    if (existing) {
      existing.semantic = score;
    } else {
      rawScores.set(row.reference, { fts: 0, semantic: score });
    }
  });

  // Merge and compute combined score, keeping individual scores for debug
  const allScored: RetrievalDebugScore[] = Array.from(rawScores.entries()).map(([ref, s]) => ({
    reference: ref,
    fts_score: s.fts,
    semantic_score: s.semantic,
    combined_score: s.fts * FTS_WEIGHT + s.semantic * SEMANTIC_WEIGHT,
  }));

  const ranked = allScored
    .filter((r) => r.combined_score >= SCORE_THRESHOLD)
    .sort((a, b) => b.combined_score - a.combined_score)
    .slice(0, TOP_K);

  if (ranked.length === 0) {
    return {
      ayahs: [],
      hitCount: 0,
      confidence: 'none',
      _debug: {
        query_used: query,
        expanded_query: expandedQuery,
        embedding_model: EMBEDDING_MODEL,
        fts_hits: ftsRows.length,
        semantic_hits: chromaRows.length,
        scores: [],
        confidence: 'none',
      },
    };
  }

  const refs = ranked.map((r) => r.reference);
  const ayahRows = getAyahsByReferences(refs);

  const refToAyah = new Map(ayahRows.map((a) => [a.reference, a]));
  const ayahs: EvidenceAyah[] = ranked
    .map((r) => {
      const row = refToAyah.get(r.reference);
      if (!row) return null;
      return { ...row, score: r.combined_score };
    })
    .filter((a): a is EvidenceAyah => a !== null);

  const confidence = classifyConfidence(ayahs);

  return {
    ayahs,
    hitCount: ayahs.length,
    confidence,
    _debug: {
      query_used: query,
      expanded_query: expandedQuery,
      embedding_model: EMBEDDING_MODEL,
      fts_hits: ftsRows.length,
      semantic_hits: chromaRows.length,
      scores: ranked,
      confidence,
    },
  };
}

// ---------- RRF + BGE-base pipeline ---------------------------------------

const RRF_K = 60; // Standard RRF constant

/**
 * Reciprocal Rank Fusion scoring over FTS + BGE-base semantic results.
 * Uses the base_quran_v2 collection (768-dim) for semantic ranking.
 * score(doc) = Σ 1/(k + rank_i) for each list the doc appears in.
 */
export async function retrieveRRF(query: string): Promise<{
  bundle: EvidenceBundle;
  rrfScores: RRFScoreRow[];
}> {
  const expandedQuery = expandQueryForSemantic(query);
  const [ftsRows, chromaRows] = await Promise.all([
    Promise.resolve(searchFTS(query, 20)),
    queryCollectionBase(expandedQuery, 20).catch(() => []),
  ]);

  // Build rank maps (1-indexed)
  const ftsRankMap = new Map<string, number>(
    ftsRows.map((r, i) => [r.reference, i + 1]),
  );
  const semanticRankMap = new Map<string, number>(
    chromaRows.map((r, i) => [r.reference, i + 1]),
  );

  const allRefs = new Set([
    ...ftsRows.map((r) => r.reference),
    ...chromaRows.map((r) => r.reference),
  ]);

  const rrfScores: RRFScoreRow[] = Array.from(allRefs).map((ref) => {
    const rankFts = ftsRankMap.get(ref) ?? 0;
    const rankSemantic = semanticRankMap.get(ref) ?? 0;
    const rrf =
      (rankFts > 0 ? 1 / (RRF_K + rankFts) : 0) +
      (rankSemantic > 0 ? 1 / (RRF_K + rankSemantic) : 0);
    return { reference: ref, rank_fts: rankFts, rank_semantic: rankSemantic, rrf_score: rrf };
  });

  const ranked = rrfScores
    .sort((a, b) => b.rrf_score - a.rrf_score)
    .slice(0, TOP_K);

  const refs = ranked.map((r) => r.reference);
  const ayahRows = getAyahsByReferences(refs);
  const refToAyah = new Map(ayahRows.map((a) => [a.reference, a]));

  // Normalise RRF score to 0..1 range for confidence classification
  const maxRrf = ranked[0]?.rrf_score ?? 1;
  const ayahs: EvidenceAyah[] = ranked
    .map((r) => {
      const row = refToAyah.get(r.reference);
      if (!row) return null;
      return { ...row, score: r.rrf_score / maxRrf };
    })
    .filter((a): a is EvidenceAyah => a !== null);

  const confidence = classifyConfidence(ayahs);

  return {
    bundle: { ayahs, hitCount: ayahs.length, confidence },
    rrfScores: ranked,
  };
}
