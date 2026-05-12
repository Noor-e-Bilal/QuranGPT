// Shared types across the QuranSays backend

export interface AyahRow {
  surah: number;
  ayah: number;
  reference: string;
  text: string;
  display_text: string;
  tokens_count: number;
}

export interface SurahRow {
  surah: number;
  name_en: string;
  ayah_count: number;
}

export interface EvidenceAyah extends AyahRow {
  score: number;
}

export type RetrievalConfidence = 'high' | 'medium' | 'low' | 'none';

export interface EvidenceBundle {
  ayahs: EvidenceAyah[];
  hitCount: number;
  confidence: RetrievalConfidence;
  /** Populated in dev mode only. */
  _debug?: RetrievalDebug;
}

export interface Citation {
  reference: string;
  surah: number;
  ayah: number;
  quote: string;
}

export interface ChatResponse {
  needs_clarification?: boolean;
  clarifying_question?: string | null;
  answer: string;
  summary: string;
  citations: Citation[];
  limitations: string | null;
  confidence: 'high' | 'medium' | 'low';
  source_policy: string;
  request_id: string;
  /** Present only in development mode. */
  debug?: DebugInfo;
}

export interface VerseResponse {
  reference: string;
  text: string;
  display_text: string;
  surah_name: string;
  surah_context: string;
  explanation: string;
  related_ayah: Array<{ reference: string; quote: string }>;
  source_policy: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  checks: { db: boolean; vector_store: boolean };
  ts: string;
}

export interface ApiError {
  error: { code: string; message: string; request_id: string };
}

export interface LLMCallDebug {
  prompt_type: 'chat' | 'clarification';
  prompt_sent: string;
  model: string;
  raw_response: string;
}

export interface RetrievalDebugScore {
  reference: string;
  fts_score: number;
  semantic_score: number;
  combined_score: number;
}

export interface RetrievalDebug {
  query_used: string;
  expanded_query: string;
  embedding_model: string;
  fts_hits: number;
  semantic_hits: number;
  scores: RetrievalDebugScore[];
  confidence: RetrievalConfidence;
}

export interface DebugInfo {
  timestamp: string;
  original_question: string;
  enriched_query: string;
  clarification_round: number;
  safety_valve: boolean;
  cache_hit: boolean;
  retrieval: RetrievalDebug;
  llm: LLMCallDebug;
}

export interface LLMChatOutput {
  needs_clarification?: boolean;
  clarifying_question?: string | null;
  answer: string;
  summary: string;
  citations: Array<{ reference: string; quote: string }>;
  limitations: string | null;
  confidence: 'high' | 'medium' | 'low';
  /** Populated in dev mode only; stripped before caching. */
  _debug?: LLMCallDebug;
}

export interface LLMVerseOutput {
  explanation: string;
  surah_context: string;
  related_references: string[];
}
