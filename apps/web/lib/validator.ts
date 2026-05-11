import type {
  LLMChatOutput,
  ChatResponse,
  Citation,
  EvidenceBundle,
  AyahRow,
} from './types';

const SOURCE_POLICY = 'The Clear Quran only';

export function validateCitations(
  llmOutput: LLMChatOutput,
  evidenceAyahs: AyahRow[]
): { citations: Citation[]; repaired: boolean } {
  const textMap = new Map(evidenceAyahs.map((a) => [a.reference, a.display_text]));
  const valid: Citation[] = [];
  let repaired = false;

  for (const c of llmOutput.citations ?? []) {
    const text = textMap.get(c.reference);
    if (!text) {
      repaired = true;
      continue;
    }
    if (!text.includes(c.quote)) {
      repaired = true;
      continue;
    }
    const [surahStr, ayahStr] = c.reference.split(':');
    valid.push({
      reference: c.reference,
      surah: parseInt(surahStr, 10),
      ayah: parseInt(ayahStr, 10),
      quote: c.quote,
    });
  }

  return { citations: valid, repaired };
}

export function buildChatResponse(
  llmOutput: LLMChatOutput,
  evidence: EvidenceBundle,
  requestId: string
): ChatResponse {
  const evidenceAyahs = evidence.ayahs.map((a) => ({
    surah: a.surah,
    ayah: a.ayah,
    reference: a.reference,
    text: a.text,
    display_text: a.display_text,
    tokens_count: a.tokens_count,
  }));

  const { citations, repaired } = validateCitations(llmOutput, evidenceAyahs);

  // Downgrade confidence if citations were stripped
  let confidence = llmOutput.confidence;
  if (repaired && citations.length === 0) {
    confidence = 'low';
  }

  // If answer has content but zero valid citations, add a limitations note
  const limitations =
    llmOutput.limitations ??
    (citations.length === 0 && llmOutput.answer.trim()
      ? 'No verifiable citations could be extracted from retrieved evidence.'
      : null);

  return {
    needs_clarification: llmOutput.needs_clarification ?? false,
    clarifying_question: llmOutput.clarifying_question ?? null,
    answer: llmOutput.answer,
    summary: llmOutput.summary,
    citations,
    limitations,
    confidence,
    source_policy: SOURCE_POLICY,
    request_id: requestId,
  };
}

export function fallbackChatResponse(requestId: string): ChatResponse {
  return {
    answer:
      'I was unable to find relevant guidance in The Clear Quran for your question. ' +
      'Please try rephrasing or ask a more specific question.',
    summary: 'No evidence found.',
    citations: [],
    limitations:
      'No ayahs were retrieved that sufficiently address this question.',
    confidence: 'low',
    source_policy: SOURCE_POLICY,
    request_id: requestId,
  };
}
