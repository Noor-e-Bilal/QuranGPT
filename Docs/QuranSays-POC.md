# QuranSays POC Document (Complete System Spec)

## 1. Product Vision
**QuranSays** is a Quran-grounded assistant where users:
1. Ask open questions on life topics in chat.
2. Open a direct ayah route `/{chapter}/{verse}` and get a grounded explanation.

For this POC, the app must answer using **only**:
- `Docs/the-clear-quran-a-thematic-english-translation.pdf`

No hadith, no tafsir, no external web lookup in core answer generation.

---

## 2. POC Objectives
### Primary Goal
Prove that Quran-grounded retrieval + controlled LLM generation can produce useful answers with **traceable ayah citations**.

### Success Criteria
1. Every non-empty answer has at least one valid citation (`surah:ayah`).
2. Citation quotes match indexed ayah text exactly (or exact substring).
3. Verse route resolves valid references and rejects invalid inputs.
4. Weak-evidence queries return explicit limitation messaging instead of fabricated certainty.
5. All outputs clearly label source policy: **The Clear Quran only**.

---

## 3. Scope Definition
### In Scope (POC v1)
- English-only.
- Single-source Quran grounding.
- Chat endpoint + UI response structure.
- Verse detail endpoint + route behavior.
- Ingestion pipeline from PDF to searchable ayah store.
- Hybrid retrieval (vector + lexical).
- Citation validation guardrails.
- Basic observability and quality metrics.

### Out of Scope (POC v1)
- Multi-source religious reasoning (hadith/tafsir/fiqh opinions).
- Personalized user profiles/history.
- Voice I/O.
- Full production security hardening beyond baseline API controls.
- Complex moderation workflows.

---

## 4. End-to-End System Architecture
## 4.1 High-Level Components
1. **PDF Ingestion Service**
   - Parses source PDF and emits structured ayah records.
2. **Quran Data Store**
   - Canonical ayah metadata + display text.
3. **Indexing Layer**
   - Embedding index for semantic recall.
   - Lexical index for keyword/reference recall.
4. **Retrieval Orchestrator**
   - Query rewrite, retrieval, rerank, evidence packaging.
5. **LLM Answer Service**
   - Generates response constrained to retrieved evidence.
6. **Citation Validator**
   - Ensures every citation exists and quote aligns with stored ayah text.
7. **API Layer**
   - `/api/chat`, `/api/verse/{chapter}/{verse}`.
8. **Web UI**
   - Chat screen and ayah detail page.

## 4.2 Runtime Flow (Chat)
1. User sends question.
2. API normalizes input and assigns `request_id`.
3. Retrieval orchestrator fetches top candidate ayahs.
4. LLM receives strict prompt + evidence bundle.
5. LLM returns structured JSON (answer + citations + uncertainty flags).
6. Citation validator checks references and quote spans.
7. API returns response with source policy badge.

## 4.3 Runtime Flow (Verse Route)
1. User opens `/{chapter}/{verse}`.
2. API validates chapter/verse range.
3. Loads verse + nearby/related ayahs.
4. LLM (or template logic) generates concise explanation grounded in provided ayahs.
5. Validator enforces that related references are valid.
6. UI renders verse, explanation, and related links.

---

## 5. Data Model
## 5.1 Canonical Tables (Logical)

| Table | Purpose | Key Columns |
|---|---|---|
| `quran_ayah` | Canonical ayah records | `surah`, `ayah`, `reference`, `text`, `tokens_count` |
| `quran_surah` | Surah metadata | `surah`, `name_en`, `ayah_count` |
| `quran_embeddings` | Vector index payload | `reference`, `embedding`, `version` |
| `quran_lexical` | Searchable text/index | `reference`, `normalized_text` |
| `chat_logs` (optional POC) | Debug/eval traces | `request_id`, `question`, `response_json`, `latency_ms` |

## 5.2 Citation Object Contract
```json
{
  "reference": "2:153",
  "surah": 2,
  "ayah": 153,
  "quote": "Seek help through patience and prayer...",
  "match_type": "exact|substring",
  "score": 0.91
}
```

---

## 6. PDF Ingestion and Indexing Pipeline
## 6.1 Pipeline Steps
1. **Extract** text from PDF.
2. **Detect** surah/ayah boundaries.
3. **Normalize** whitespace and punctuation for search copy.
4. **Preserve** display copy for UI (without destructive normalization).
5. **Validate** counts and references (surah 1..114, ayah ranges per surah).
6. **Persist** canonical ayah records.
7. **Embed** each ayah (or ayah + short context window).
8. **Index** lexical fields and embeddings.

## 6.2 Data Quality Checks
- No duplicate `reference`.
- No missing ayah in a surah sequence.
- No orphan embeddings without canonical ayah.
- Extraction anomaly report for manual review.

## 6.3 Re-index Strategy
- Version indexes (`index_version`).
- Blue/green swap for safe rollouts:
  - Build new index.
  - Run smoke retrieval checks.
  - Switch active version.

---

## 7. Retrieval and LLM Interaction Design
## 7.1 Retrieval Stages
1. **Query preprocessing**
   - lowercasing, punctuation trim, simple expansion (patience/sabr-like synonyms if curated).
2. **Dual retrieval**
   - vector top-k (e.g., 20)
   - lexical top-k (e.g., 20)
3. **Merge + dedupe**
4. **Rerank**
   - relevance score + coverage diversity.
5. **Evidence cutoff**
   - keep top n (e.g., 5-8) above threshold.

## 7.2 LLM Prompt Contract (System Behavior)
Model instructions must enforce:
1. Use only provided evidence set.
2. Do not cite references not present in evidence.
3. If evidence is weak, return uncertainty note.
4. Output strict JSON schema.

## 7.3 Suggested LLM Output Schema
```json
{
  "answer": "string",
  "summary": "string",
  "citations": [
    {
      "reference": "2:153",
      "quote": "..."
    }
  ],
  "limitations": "string|null",
  "confidence": "high|medium|low"
}
```

## 7.4 Hallucination Controls
- Response rejected if:
  - citation reference not found in evidence.
  - quote cannot be matched to canonical text.
  - JSON invalid.
- On rejection: one repair pass (schema/citation fix) or fallback safe response.

---

## 8. Chat Experience Specification
## 8.1 Functional Behavior
1. Accept free-text question.
2. Return:
   - `answer` (human-friendly)
   - `citations[]`
   - `limitations` when needed
   - `confidence`
3. Show source badge: **Grounded in The Clear Quran only**.

## 8.2 Example API
### `POST /api/chat`
Request:
```json
{
  "question": "How do I stay patient during hardship?"
}
```
Response:
```json
{
  "answer": "The Quran encourages seeking help through patience and prayer...",
  "summary": "Patience and remembrance are recurring guidance in hardship.",
  "citations": [
    {"reference": "2:153", "quote": "Seek help through patience and prayer..."},
    {"reference": "13:28", "quote": "Surely in the remembrance of Allah do hearts find comfort."}
  ],
  "limitations": null,
  "confidence": "high",
  "source_policy": "The Clear Quran only"
}
```

## 8.3 Fallback Example (Weak Evidence)
```json
{
  "answer": "I could not find strong direct evidence for that exact framing in this source alone.",
  "summary": "Closest related verses are provided below.",
  "citations": [
    {"reference": "16:43", "quote": "...ask those who know..."}
  ],
  "limitations": "Quran-only source may not cover this as a direct rule.",
  "confidence": "low",
  "source_policy": "The Clear Quran only"
}
```

---

## 9. Verse Route Specification
## 9.1 URL Contract
- Public route: `/{chapter}/{verse}`
- Example: `/1/1`

Validation:
- `chapter`: integer 1..114
- `verse`: integer 1..`ayah_count(chapter)`

## 9.2 Endpoint
### `GET /api/verse/{chapter}/{verse}`
Response:
```json
{
  "reference": "1:1",
  "text": "In the Name of Allah...",
  "surah_context": "Opening of the Quran; a prayer and guidance orientation.",
  "explanation": "This opening begins with invoking Allah and sets the devotional tone...",
  "related_ayah": [
    {"reference": "17:110", "quote": "Call upon Allah..."},
    {"reference": "39:53", "quote": "Do not lose hope in Allah's mercy..."}
  ],
  "source_policy": "The Clear Quran only"
}
```

## 9.3 Explanation Generation Rules
1. Explain verse meaning in plain language.
2. Ground explanation in verse text + related ayahs only.
3. No external historical/legal claims unless directly in cited Quran text.
4. Include 2-5 related references where available.

---

## 10. API Surface (POC)
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | Quran-grounded Q&A with citations |
| `/api/verse/{chapter}/{verse}` | GET | Verse content + explanation |
| `/api/health` | GET | Service health/readiness |

### Standard Error Model
```json
{
  "error": {
    "code": "INVALID_REFERENCE",
    "message": "Verse 500 does not exist in Surah 1.",
    "request_id": "uuid"
  }
}
```

Suggested error codes:
- `INVALID_REFERENCE`
- `VERSE_NOT_FOUND`
- `QUESTION_TOO_LONG`
- `INSUFFICIENT_EVIDENCE`
- `INTERNAL_ERROR`

---

## 11. UI/UX Contract
## 11.1 Chat Screen
- Input textarea + send button.
- Answer card with:
  - primary answer
  - confidence badge
  - citations list (clickable chips)
  - expandable quote details
  - limitation callout when low confidence

## 11.2 Verse Screen
- Header: `Surah X • Ayah Y`
- Verse text block
- Explanation block
- Related ayah links
- Back-link to chat with prefilled question option (optional POC enhancement)

---

## 12. Security, Safety, and Policy
1. No external source blending in core response.
2. Rate limit chat endpoint (basic anti-abuse).
3. Log request IDs, not sensitive user data.
4. Strict JSON response validation before returning to client.
5. If question requests harmful action, still return Quran-grounded non-harm framing with citations where available.

---

## 13. Observability and Operations
Track minimum metrics:
- `chat_requests_total`
- `chat_latency_ms_p95`
- `retrieval_hit_rate`
- `citation_validation_fail_rate`
- `fallback_rate_low_confidence`

Log structure per request:
- `request_id`
- retrieval candidates count
- selected citations
- model latency
- validation pass/fail

---

## 14. Testing and Evaluation Plan
## 14.1 Ingestion Tests
- Parse known sample pages.
- Validate surah/ayah sequencing.
- Detect duplicate references.

## 14.2 Retrieval Tests
- Fixed query set with expected references.
- Check top-k contains at least one known relevant ayah.

## 14.3 Generation Tests
- Schema compliance tests.
- Citation existence tests.
- Quote match tests.
- Low-confidence fallback tests.

## 14.4 API Tests
- Valid and invalid route tests for `/api/verse/{chapter}/{verse}`.
- Chat request/response contract tests.

---

## 15. Deployment Blueprint (POC)
## 15.1 Services
- `frontend-web`
- `api-service`
- `index-worker` (offline ingestion/indexing)

## 15.2 Environment Variables (Example)
- `LLM_API_KEY`
- `EMBEDDING_MODEL`
- `CHAT_MODEL`
- `VECTOR_INDEX_URI`
- `SOURCE_POLICY=the_clear_quran_only`

## 15.3 Release Steps
1. Build ingestion artifact.
2. Run validation checks.
3. Publish new index version.
4. Deploy API with new index pointer.
5. Smoke test chat + verse endpoints.

---

## 16. Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| PDF extraction errors | Wrong citations | validation against reference map + anomaly report |
| Hallucinated references | Trust loss | strict citation validator + reject/repair loop |
| Overconfident answers on weak evidence | Misleading guidance | confidence thresholds + limitation messaging |
| Latency spikes from hybrid retrieval | UX degradation | cache frequent queries + tune top-k/rerank |

---

## 17. Implementation Milestones (POC)
1. Build ingestion parser + canonical ayah dataset.
2. Build lexical/vector index and retrieval API.
3. Implement chat generation with strict schema and citation validation.
4. Implement verse route and explanation API.
5. Add integration tests and observability metrics.
6. Ship internal demo.

---

## 18. Explicit Product Assumptions
1. Source-of-truth is fixed to The Clear Quran PDF for this phase.
2. English rendering is sufficient for POC users.
3. "Ask anything" means broad topic coverage, not guaranteed deterministic ruling on all topics.
4. When direct evidence is weak, the system must abstain gracefully instead of guessing.
