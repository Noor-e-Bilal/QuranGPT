import { searchFTS, getAyahsByReferences, expandQueryForSemantic } from './db';
import { queryCollection } from './chroma';
import type { EvidenceAyah, EvidenceBundle, RetrievalConfidence } from './types';

const FTS_WEIGHT = 0.4;
const SEMANTIC_WEIGHT = 0.6;
const SCORE_THRESHOLD = 0.15;   // Minimum score to include a hit
const TOP_K = 10;

// Tiered confidence thresholds (calibrated for BGE cosine similarity scores)
const HIGH_SCORE = 0.50;   // Strong evidence: direct semantic match
const MEDIUM_SCORE = 0.30; // Partial evidence: related but not precise

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

  const scores = new Map<string, { fts: number; semantic: number }>();

  // FTS rank: position-based score (0..1, best rank = 1)
  ftsRows.forEach((row, idx) => {
    const score = 1 - idx / Math.max(ftsRows.length, 1);
    scores.set(row.reference, { fts: score, semantic: 0 });
  });

  // Semantic score: 1 - distance (ChromaDB returns cosine distance 0..2)
  chromaRows.forEach((row) => {
    const score = Math.max(0, 1 - row.distance / 2);
    const existing = scores.get(row.reference);
    if (existing) {
      existing.semantic = score;
    } else {
      scores.set(row.reference, { fts: 0, semantic: score });
    }
  });

  // Merge and compute combined score
  const ranked = Array.from(scores.entries())
    .map(([ref, s]) => ({
      reference: ref,
      combined: s.fts * FTS_WEIGHT + s.semantic * SEMANTIC_WEIGHT,
    }))
    .filter((r) => r.combined >= SCORE_THRESHOLD)
    .sort((a, b) => b.combined - a.combined)
    .slice(0, TOP_K);

  if (ranked.length === 0) {
    return { ayahs: [], hitCount: 0, confidence: 'none' };
  }

  const refs = ranked.map((r) => r.reference);
  const ayahRows = getAyahsByReferences(refs);

  const refToAyah = new Map(ayahRows.map((a) => [a.reference, a]));
  const ayahs: EvidenceAyah[] = ranked
    .map((r) => {
      const row = refToAyah.get(r.reference);
      if (!row) return null;
      return { ...row, score: r.combined };
    })
    .filter((a): a is EvidenceAyah => a !== null);

  return { ayahs, hitCount: ayahs.length, confidence: classifyConfidence(ayahs) };
}
