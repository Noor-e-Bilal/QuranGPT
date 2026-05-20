import type {
  LLMChatOutput,
  ChatResponse,
  Citation,
  EvidenceBundle,
  AyahRow,
} from './types';

const SOURCE_POLICY = 'The Clear Quran only';

/** Normalize special typographic characters so LLM quotes match original text. */
function normalizeQuoteChars(s: string): string {
  return s
    .replace(/˹/g, '[')
    .replace(/˺/g, ']')
    .replace(/\u2018|\u2019/g, "'")   // curly single quotes → '
    .replace(/\u201C|\u201D/g, '"');  // curly double quotes → "
}

export function validateCitations(
  llmOutput: LLMChatOutput,
  evidenceAyahs: AyahRow[]
): { citations: Citation[]; repaired: boolean } {
  const textMap = new Map(evidenceAyahs.map((a) => [a.reference, a.display_text]));
  const valid: Citation[] = [];
  let repaired = false;

  for (const c of llmOutput.citations ?? []) {
    // Guard against null/non-object items and missing/invalid field types
    if (
      !c ||
      typeof c !== 'object' ||
      typeof (c as Record<string,unknown>).reference !== 'string' ||
      typeof (c as Record<string,unknown>).quote !== 'string' ||
      ((c as Record<string,unknown>).quote as string).trim().length === 0
    ) {
      repaired = true;
      continue;
    }
    // Normalize reference: strip surrounding brackets e.g. "[70:33]" → "70:33"
    const rawRef = ((c as Record<string,unknown>).reference as string).replace(/^\[|\]$/g, '').trim();
    const rawQuote = ((c as Record<string,unknown>).quote as string);
    const text = textMap.get(rawRef);
    if (!text) {
      repaired = true;
      continue;
    }
    // Normalize typographic characters before comparison so LLMs that substitute
    // ˹˺ with [] (or curly quotes with straight quotes) still pass validation.
    const normalizedText = normalizeQuoteChars(text);
    // Also strip surrounding single/double quotes from quote (Ollama wraps quotes)
    const normalizedQuote = normalizeQuoteChars(rawQuote).replace(/^['''"""]+|['''"""]+$/g, '').trim();
    if (!normalizedText.includes(normalizedQuote)) {
      repaired = true;
      continue;
    }
    const [surahStr, ayahStr] = rawRef.split(':');
    valid.push({
      reference: rawRef,
      surah: parseInt(surahStr, 10),
      ayah: parseInt(ayahStr, 10),
      quote: rawQuote,
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
    (citations.length === 0 && (llmOutput.answer ?? '').trim()
      ? 'No verifiable citations could be extracted from retrieved evidence.'
      : null);

  return {
    needs_clarification: llmOutput.needs_clarification ?? false,
    clarifying_question: llmOutput.clarifying_question ?? null,
    answer: llmOutput.answer ?? '',
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

/**
 * Returned when the user has gone through the maximum clarification rounds
 * and retrieval still cannot reach high confidence. Rather than forcing a
 * low-quality answer, we decline gracefully.
 */
export function maxRoundsDeclineResponse(requestId: string): ChatResponse {
  return {
    answer:
      'After several rounds of clarification I still could not find specific enough ' +
      'Quranic evidence to give a reliable answer. This topic may be too broad, or ' +
      'The Clear Quran may not address it with enough specificity. ' +
      'Please try asking about a narrower, more concrete aspect.',
    summary: 'Insufficient evidence after maximum clarification rounds.',
    citations: [],
    limitations: null,
    confidence: 'low',
    source_policy: SOURCE_POLICY,
    request_id: requestId,
  };
}
