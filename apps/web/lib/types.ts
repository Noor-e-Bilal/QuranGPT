// Shared types across the QuranSays backend

// ---- Provider / LLM settings ----

export type LLMProvider = 'opencode' | 'claude' | 'openai' | 'openrouter';

export interface ProviderSettings {
  provider: LLMProvider;
  model: string;
  /** 0.0 – 1.0 */
  temperature: number;
}

export const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
  opencode: ['minimax-m2.5-free'],
  claude: ['claude-opus-4-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
  openrouter: [
    'google/gemini-2.5-flash-preview:free',
    'meta-llama/llama-4-maverick:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'deepseek/deepseek-chat-v3-0324:free',
  ],
};

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  provider: 'opencode',
  model: 'minimax-m2.5-free',
  temperature: 0.7,
};

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
  /** Original question reformulated for retrieval (shown in UI). */
  reformulated_query?: string;
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
  reformulated_query?: string;
  enriched_query: string;
  clarification_round: number;
  safety_valve: boolean;
  cache_hit: boolean;
  provider_settings?: Pick<ProviderSettings, 'provider' | 'model'>;
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

// ---- Pipeline comparison types ----

export interface RRFScoreRow {
  reference: string;
  /** 1-indexed FTS rank; 0 = not in FTS results */
  rank_fts: number;
  /** 1-indexed semantic rank; 0 = not in semantic results */
  rank_semantic: number;
  rrf_score: number;
}

export interface ComparisonPipelineResult {
  label: string;
  formula: string;
  confidence: RetrievalConfidence;
  ayahs: EvidenceAyah[];
  scores: RetrievalDebugScore[] | RRFScoreRow[];
}

export interface ComparisonBundle {
  query: string;
  current: ComparisonPipelineResult;
  candidate: ComparisonPipelineResult;
  /** Surfaced in the UI to explain model-upgrade limitations. */
  note: string;
}

/**
 * A full LLM-generated answer produced by one retrieval pipeline.
 * Returned by /api/compare — one per pipeline (current vs upgrade).
 */
export interface ComparePanelResult {
  /** Human-readable pipeline name, e.g. "Current" or "Upgrade" */
  label: string;
  /** Formula description, e.g. "BGE-small · FTS×0.4 + Semantic×0.6" */
  formula: string;
  answer: string;
  summary: string;
  citations: Citation[];
  limitations: string | null;
  confidence: RetrievalConfidence;
  source_policy: string;
  reformulated_query?: string;
}
