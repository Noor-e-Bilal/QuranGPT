import Anthropic from '@anthropic-ai/sdk';
import type { EvidenceBundle, LLMChatOutput, LLMVerseOutput, AyahRow } from './types';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'minimax-m2.5-free';

function client() {
  return new Anthropic({
    baseURL: process.env.ANTHROPIC_BASE_URL ?? 'https://opencode.ai/zen',
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  });
}

// ---------- Chat ----------------------------------------------------------

const MAX_AYAH_CHARS = 200;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

function buildChatPrompt(question: string, evidence: EvidenceBundle): string {
  const evidenceText = evidence.ayahs
    .map((a) => `[${a.reference}] "${truncate(a.display_text, MAX_AYAH_CHARS)}"`)
    .join('\n');

  return `You are QuranSays, a scholarly assistant that answers ALL questions exclusively from The Clear Quran.

EVIDENCE (retrieved ayahs):
${evidenceText || '(no ayahs retrieved)'}

USER QUESTION: ${question}

RESPONSE RULES:
1. Answer ONLY using the evidence above. Never invent citations.
2. Each citation quote must be an EXACT verbatim substring of the ayah text above.
3. If evidence is insufficient, set confidence="low" and explain in limitations.
4. Return ONLY valid JSON matching this exact schema — no markdown fences, no extra text:

{
  "answer": "<full answer>",
  "summary": "<≤30 word summary>",
  "citations": [
    { "reference": "<surah:ayah>", "quote": "<exact verbatim substring>" }
  ],
  "limitations": "<null or explanation if evidence is weak>",
  "confidence": "<high|medium|low>"
}`;
}

export async function generateChatResponse(
  question: string,
  evidence: EvidenceBundle
): Promise<LLMChatOutput> {
  const prompt = buildChatPrompt(question, evidence);
  const raw = await callLLM(prompt);
  return parseWithRepair<LLMChatOutput>(raw, {
    answer: 'Unable to generate a response at this time.',
    summary: 'Error',
    citations: [],
    limitations: 'LLM response could not be parsed.',
    confidence: 'low',
  });
}

// ---------- Verse ---------------------------------------------------------

function buildVersePrompt(ayah: AyahRow, related: AyahRow[]): string {
  const relatedText = related
    .map((a) => `[${a.reference}] "${a.display_text}"`)
    .join('\n');

  return `You are QuranSays. Explain the following Quran ayah in depth.

AYAH: [${ayah.reference}] "${ayah.display_text}"

RELATED AYAHS (for cross-reference only):
${relatedText || '(none)'}

Return ONLY valid JSON (no markdown fences) matching this schema:

{
  "explanation": "<detailed explanation of the ayah>",
  "surah_context": "<brief context about this surah and where this ayah fits>",
  "related_references": ["<reference>", ...]
}`;
}

export async function generateVerseExplanation(
  ayah: AyahRow,
  related: AyahRow[]
): Promise<LLMVerseOutput> {
  const prompt = buildVersePrompt(ayah, related);
  const raw = await callLLM(prompt);
  return parseWithRepair<LLMVerseOutput>(raw, {
    explanation: 'Unable to generate explanation.',
    surah_context: '',
    related_references: [],
  });
}

// ---------- Shared helpers ------------------------------------------------

async function callLLM(prompt: string): Promise<string> {
  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = msg.content.find((b) => b.type === 'text');
  return block?.type === 'text' ? block.text : '';
}

function parseWithRepair<T>(raw: string, fallback: T): T {
  // Strip optional markdown code fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // First attempt
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Repair attempt: find first { and last }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        // fall through
      }
    }
    console.error('[LLM] parse failed, using fallback. Raw preview:', raw.slice(0, 200));
    return fallback;
  }
}
