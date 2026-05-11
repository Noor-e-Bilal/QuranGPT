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

STEP 1 — CLARIFICATION CHECK (do this before answering):
Ask yourself: "Is this question clear enough to answer from the Quran?"
Request clarification if ANY of these apply:
  • The question is too vague or broad (e.g., "tell me about Islam", "explain everything")
  • A single word with no context (e.g., "prayer", "zakat")
  • The question could mean 2+ very different things with different answers
  • A term is used that is completely unrecognizable and not an Islamic concept
If clarification is needed, set "needs_clarification": true and write a SHORT, friendly
counter-question in "clarifying_question" offering 2–3 specific options. Leave answer/citations empty.

Do NOT request clarification for:
  • Questions using Arabic Islamic terms (jihad, salah, zakat, taqwa, etc.) — the system knows these
  • Questions with minor grammar issues but clear intent
  • Broad but mappable questions (e.g., "what is prayer", "what does Islam say about kindness")

STEP 2 — ANSWER (only if no clarification needed):
1. Answer ONLY using the evidence above. Never invent citations.
2. Each citation quote must be an EXACT verbatim substring of the ayah text above.
3. If evidence is insufficient, set confidence="low" and explain in limitations.

Return ONLY valid JSON — no markdown fences, no extra text:

{
  "needs_clarification": false,
  "clarifying_question": null,
  "answer": "<full answer>",
  "summary": "<≤30 word summary>",
  "citations": [
    { "reference": "<surah:ayah>", "quote": "<exact verbatim substring>" }
  ],
  "limitations": "<null or explanation if evidence is weak>",
  "confidence": "<high|medium|low>"
}

If clarification needed, use this shape instead:
{
  "needs_clarification": true,
  "clarifying_question": "<short friendly question with 2-3 options>",
  "answer": "",
  "summary": "",
  "citations": [],
  "limitations": null,
  "confidence": "low"
}`;
}

export async function generateChatResponse(
  question: string,
  evidence: EvidenceBundle
): Promise<LLMChatOutput> {
  const prompt = buildChatPrompt(question, evidence);
  const raw = await callLLM(prompt);
  return parseWithRepair<LLMChatOutput>(raw, {
    needs_clarification: false,
    clarifying_question: null,
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
    .map((a) => `[${a.reference}] "${truncate(a.display_text, MAX_AYAH_CHARS)}"`)
    .join('\n');

  return `You are QuranSays. Explain the following Quran ayah concisely (2-3 sentences).

AYAH: [${ayah.reference}] "${truncate(ayah.display_text, 300)}"

RELATED AYAHS (for cross-reference only):
${relatedText || '(none)'}

Return ONLY valid JSON (no markdown fences) matching this schema:

{
  "explanation": "<2-3 sentence explanation>",
  "surah_context": "<one sentence about where this fits in the surah>",
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
    max_tokens: 3000,
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
