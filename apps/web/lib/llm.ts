import Anthropic from "@anthropic-ai/sdk";
import type {
  EvidenceBundle,
  LLMChatOutput,
  LLMVerseOutput,
  AyahRow,
  RetrievalConfidence,
} from "./types";

const MODEL = process.env.ANTHROPIC_MODEL ?? "minimax-m2.5-free";

function client() {
  return new Anthropic({
    baseURL: process.env.ANTHROPIC_BASE_URL ?? "https://opencode.ai/zen",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  });
}

// ---------- Chat ----------------------------------------------------------

const MAX_AYAH_CHARS = 200;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

function buildChatPrompt(
  question: string,
  evidence: EvidenceBundle,
  safetyValve = false,
): string {
  const evidenceText = evidence.ayahs
    .map(
      (a) => `[${a.reference}] "${truncate(a.display_text, MAX_AYAH_CHARS)}"`,
    )
    .join("\n");

  const safetyNote = safetyValve
    ? '\n⚠️ SAFETY VALVE ACTIVE: After multiple clarification rounds, present the best available answer. Set confidence="medium" and explain limitations clearly. Do NOT ask for clarification again.\n'
    : "";

  return `You are QuranSays, a scholarly assistant that answers ALL questions exclusively from The Clear Quran.
${safetyNote}
EVIDENCE (retrieved ayahs):
${evidenceText || "(no ayahs retrieved)"}

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
⛔ STRICT EVIDENCE BOUNDARY: Your answer must be built SOLELY from the EVIDENCE block above.
   Do NOT use your training data, general Islamic knowledge, Hadith, tafsir, or any source
   outside the retrieved ayahs. The EVIDENCE block IS the Quran for this response.
1. Every claim and sentence in your answer must be directly supported by an ayah in the EVIDENCE block.
2. If the evidence does not address part of the question, omit that part — do not fill gaps from memory.
3. Each citation quote must be an EXACT verbatim substring of the ayah text above. Never invent citations.
4. If the retrieved ayahs are insufficient to answer well, set confidence="low", explain in limitations,
   and keep the answer brief — do NOT supplement with outside knowledge to make it seem complete.

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

/**
 * Generates a targeted clarification question when retrieval confidence is
 * medium/low. Unlike the general chat prompt, this is explicitly biased
 * toward asking a follow-up rather than attempting an answer.
 */
function buildClarificationPrompt(
  question: string,
  evidence: EvidenceBundle,
  confidence: RetrievalConfidence,
): string {
  const topAyahs = evidence.ayahs.slice(0, 3);
  const partialContext =
    topAyahs.length > 0
      ? `The search found partially related content:\n${topAyahs
          .map((a) => `  [${a.reference}] "${truncate(a.display_text, 100)}"`)
          .join("\n")}`
      : "No directly relevant Quran verses were found.";

  const confidenceNote =
    confidence === "medium"
      ? "Evidence is partial — related content was found but the question needs more specificity to give a precise answer."
      : "Evidence is weak or missing — the question may need to be rephrased or connected to a Quranic concept.";

  return `You are QuranSays. A user asked: "${question}"

${partialContext}

${confidenceNote}

Your task: generate a SHORT, helpful clarifying question (1-2 sentences) that:
1. Gently acknowledges the topic area that was found (if any)
2. Asks the user to be more specific OR offers 2-3 concrete alternative angles to explore
3. Is friendly and encouraging — not dismissive

Return ONLY valid JSON:

{
  "needs_clarification": true,
  "clarifying_question": "<targeted question with 2-3 specific options>",
  "answer": "",
  "summary": "",
  "citations": [],
  "limitations": null,
  "confidence": "low"
}`;
}

export async function generateChatResponse(
  question: string,
  evidence: EvidenceBundle,
  safetyValve = false,
): Promise<LLMChatOutput> {
  const prompt = buildChatPrompt(question, evidence, safetyValve);
  const raw = await callLLM(prompt);
  const output = parseWithRepair<LLMChatOutput>(raw, {
    needs_clarification: false,
    clarifying_question: null,
    answer: "Unable to generate a response at this time.",
    summary: "Error",
    citations: [],
    limitations: "LLM response could not be parsed.",
    confidence: "low",
  });
  output._debug = {
    prompt_type: "chat",
    prompt_sent: prompt,
    model: MODEL,
    raw_response: raw,
  };
  return output;
}

/**
 * Generates a targeted clarification question when retrieval confidence is
 * below HIGH. Returns a needs_clarification=true response with a specific question.
 */
export async function generateClarificationQuestion(
  question: string,
  evidence: EvidenceBundle,
  confidence: RetrievalConfidence,
): Promise<LLMChatOutput> {
  const prompt = buildClarificationPrompt(question, evidence, confidence);
  const raw = await callLLM(prompt);
  const output = parseWithRepair<LLMChatOutput>(raw, {
    needs_clarification: true,
    clarifying_question:
      "Could you clarify what specific aspect you'd like to explore in the Quran?",
    answer: "",
    summary: "",
    citations: [],
    limitations: null,
    confidence: "low",
  });
  output._debug = {
    prompt_type: "clarification",
    prompt_sent: prompt,
    model: MODEL,
    raw_response: raw,
  };
  return output;
}

// ---------- Verse ---------------------------------------------------------

function buildVersePrompt(ayah: AyahRow, related: AyahRow[]): string {
  const relatedText = related
    .map(
      (a) => `[${a.reference}] "${truncate(a.display_text, MAX_AYAH_CHARS)}"`,
    )
    .join("\n");

  return `You are QuranSays. Explain the following Quran ayah concisely (2-3 sentences).

AYAH: [${ayah.reference}] "${truncate(ayah.display_text, 300)}"

RELATED AYAHS (for cross-reference only):
${relatedText || "(none)"}

Return ONLY valid JSON (no markdown fences) matching this schema:

{
  "explanation": "<2-3 sentence explanation>",
  "surah_context": "<one sentence about where this fits in the surah>",
  "related_references": ["<reference>", ...]
}`;
}

export async function generateVerseExplanation(
  ayah: AyahRow,
  related: AyahRow[],
): Promise<LLMVerseOutput> {
  const prompt = buildVersePrompt(ayah, related);
  const raw = await callLLM(prompt);
  return parseWithRepair<LLMVerseOutput>(raw, {
    explanation: "Unable to generate explanation.",
    surah_context: "",
    related_references: [],
  });
}

// ---------- Shared helpers ------------------------------------------------

async function callLLM(prompt: string): Promise<string> {
  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: 3000,
    temperature: 1.0,
    messages: [{ role: "user", content: prompt }],
  });

  const block = msg.content.find((b) => b.type === "text");
  return block?.type === "text" ? block.text : "";
}

function parseWithRepair<T>(raw: string, fallback: T): T {
  // Strip optional markdown code fences
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // First attempt
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Repair attempt: find first { and last }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        // fall through
      }
    }
    console.error(
      "[LLM] parse failed, using fallback. Raw preview:",
      raw.slice(0, 200),
    );
    return fallback;
  }
}
