import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type {
  EvidenceBundle,
  LLMChatOutput,
  LLMVerseOutput,
  AyahRow,
  RetrievalConfidence,
  ProviderSettings,
} from "./types";

/** Default (reformulation) model — always minimax via opencode.ai. */
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "minimax-m2.5-free";

/** Build the right SDK client based on ProviderSettings. Falls back to default. */
function getClient(
  settings?: ProviderSettings,
): { callText: (prompt: string, temp: number) => Promise<string> } {
  if (!settings || settings.provider === "opencode") {
    // Default: minimax via opencode.ai using Anthropic SDK
    const model =
      settings?.provider === "opencode" ? settings.model : DEFAULT_MODEL;
    const anthropic = new Anthropic({
      baseURL: process.env.ANTHROPIC_BASE_URL ?? "https://opencode.ai/zen",
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    });
    return {
      callText: async (prompt, temp) => {
        const msg = await anthropic.messages.create({
          model,
          max_tokens: 3000,
          temperature: temp,
          messages: [{ role: "user", content: prompt }],
        });
        const block = msg.content.find((b) => b.type === "text");
        return block?.type === "text" ? block.text : "";
      },
    };
  }

  if (settings.provider === "claude") {
    const anthropic = new Anthropic({
      baseURL:
        process.env.CLAUDE_BASE_URL ?? "https://api.anthropic.com",
      apiKey: process.env.CLAUDE_API_KEY ?? "",
    });
    return {
      callText: async (prompt, temp) => {
        const msg = await anthropic.messages.create({
          model: settings.model,
          max_tokens: 3000,
          temperature: temp,
          messages: [{ role: "user", content: prompt }],
        });
        const block = msg.content.find((b) => b.type === "text");
        return block?.type === "text" ? block.text : "";
      },
    };
  }

  // openai or openrouter — both use the OpenAI-compatible SDK
  const openai = new OpenAI({
    apiKey:
      settings.provider === "openai"
        ? (process.env.OPENAI_API_KEY ?? "")
        : (process.env.OPENROUTER_API_KEY ?? ""),
    baseURL:
      settings.provider === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : undefined, // OpenAI default base URL
    defaultHeaders:
      settings.provider === "openrouter"
        ? { "HTTP-Referer": "https://quransays.app", "X-Title": "QuranSays" }
        : undefined,
  });
  return {
    callText: async (prompt, temp) => {
      const completion = await openai.chat.completions.create({
        model: settings.model,
        max_tokens: 3000,
        temperature: temp,
        messages: [{ role: "user", content: prompt }],
      });
      return completion.choices[0]?.message?.content ?? "";
    },
  };
}

/** All free OpenCode Zen models, used for 429 rotation. */
const OPENCODE_FREE_MODELS = [
  'minimax-m2.5-free',
  'deepseek-v4-flash-free',
  'nemotron-3-super-free',
  'big-pickle',
];

async function callLLM(
  prompt: string,
  settings?: ProviderSettings,
): Promise<string> {
  const temp = settings?.temperature ?? 1.0;
  try {
    return await getClient(settings).callText(prompt, temp);
  } catch (err: unknown) {
    const status = (err as Record<string, unknown>)?.status;
    const isOpencode = !settings || settings.provider === "opencode";

    if (status === 429 && isOpencode) {
      const currentModel = settings?.model ?? DEFAULT_MODEL;
      const msg = (err as Record<string, unknown>)?.message ?? "";
      console.warn(`[llm] opencode.ai 429 on ${currentModel} (${msg}) — rotating models`);

      // Try each other free model in order
      const others = OPENCODE_FREE_MODELS.filter((m) => m !== currentModel);
      for (const fallbackModel of others) {
        try {
          console.warn(`[llm] trying ${fallbackModel} after 429`);
          const fallback: ProviderSettings = {
            provider: "opencode",
            model: fallbackModel,
            temperature: temp,
          };
          return await getClient(fallback).callText(prompt, temp);
        } catch (retryErr: unknown) {
          const retryStatus = (retryErr as Record<string, unknown>)?.status;
          if (retryStatus !== 429) throw retryErr; // non-rate-limit error — bail
          console.warn(`[llm] ${fallbackModel} also 429, trying next`);
        }
      }
      // All free models exhausted
      throw err;
    }
    throw err;
  }
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
  settings?: ProviderSettings,
): Promise<LLMChatOutput> {
  const prompt = buildChatPrompt(question, evidence, safetyValve);
  const raw = await callLLM(prompt, settings);
  const model = settings?.model ?? DEFAULT_MODEL;
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
    model,
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
  settings?: ProviderSettings,
): Promise<LLMChatOutput> {
  const prompt = buildClarificationPrompt(question, evidence, confidence);
  const raw = await callLLM(prompt, settings);
  const model = settings?.model ?? DEFAULT_MODEL;
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
    model,
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
  settings?: ProviderSettings,
): Promise<LLMVerseOutput> {
  const prompt = buildVersePrompt(ayah, related);
  const raw = await callLLM(prompt, settings);
  return parseWithRepair<LLMVerseOutput>(raw, {
    explanation: "Unable to generate explanation.",
    surah_context: "",
    related_references: [],
  });
}

// ---------- Shared helpers ------------------------------------------------

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

// ---------- Query reformulation -------------------------------------------

const REFORMULATION_PROMPT = (raw: string) =>
  `You are a search-query optimizer for a Quranic knowledge base.
Rewrite the user question below into a rich, specific retrieval query that maximises recall of relevant Quran verses. 
Rules:
- Expand abbreviations and add relevant Islamic terminology
- Make implicit concepts explicit (e.g. "be patient" → "patience perseverance sabr hardship")
- Keep the output under 40 words
- Return ONLY the rewritten query — no explanation, no punctuation beyond the query itself

User question: "${raw}"`;

/**
 * Rewrites a short user question into a richer semantic search query.
 * Always uses the default (minimax) model regardless of user provider choice.
 * Returns the original question unchanged if reformulation fails.
 */
export async function reformulateQuery(raw: string): Promise<string> {
  try {
    const result = await callLLM(REFORMULATION_PROMPT(raw));
    const cleaned = result.trim().replace(/^["']|["']$/g, "");
    return cleaned || raw;
  } catch {
    return raw;
  }
}
