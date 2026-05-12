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

export interface LLMChatOutput {
  needs_clarification?: boolean;
  clarifying_question?: string | null;
  answer: string;
  summary: string;
  citations: Array<{ reference: string; quote: string }>;
  limitations: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface LLMVerseOutput {
  explanation: string;
  surah_context: string;
  related_references: string[];
}
