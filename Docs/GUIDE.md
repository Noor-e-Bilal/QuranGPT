# QuranSays — Complete Project Guide

> **Source:** The Clear Quran — A Thematic English Translation (PDF)
> **Stack:** Next.js 14 (App Router) · SQLite (FTS5) · ChromaDB · BGE Embeddings · Multi-Provider LLM
> **Tagline:** Quran-grounded answers with traceable ayah citations.

---

## Table of Contents

- [1. Quick Start (From Scratch)](#1-quick-start-from-scratch)
- [2. Running the App Day-to-Day](#2-running-the-app-day-to-day)
- [3. Pipeline Reference](#3-pipeline-reference)
- [4. Infrastructure Architecture](#4-infrastructure-architecture)
- [5. Retrieval & RAG Pipeline](#5-retrieval--rag-pipeline)
- [6. Semantic Caching (Two-Tier)](#6-semantic-caching-two-tier)
- [7. LLM Integration](#7-llm-integration)
- [8. Citation Validation](#8-citation-validation)
- [9. Clarification Loop & Confidence Gating](#9-clarification-loop--confidence-gating)
- [10. Bayyinah Tafseer Scraper](#10-bayyinah-tafseer-scraper)
- [11. Database Schema](#11-database-schema)
- [12. Deployment (AWS ECS)](#12-deployment-aws-ecs)
- [13. Environment Variables Reference](#13-environment-variables-reference)

---

## 1. Quick Start (From Scratch)

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.11+ | `brew install python` |
| Node.js | 18+ | `brew install node` |
| Docker Desktop | Latest | [docker.com](https://docker.com) |
| ADB (scraper only) | — | `brew install --cask android-platform-tools` |

### Step 1 — Extract Quran text from PDF

```bash
cd /path/to/QuranSays

# Install Python dependencies
pip3 install -r scripts/ingest/requirements.txt

# Extract ayahs from the PDF
python3 scripts/ingest/extract_pdf.py
# → Output: data/ayahs.json  (6,236 ayahs extracted)
```

The PDF lives at `Docs/the-clear-quran-a-thematic-english-translation.pdf`. The extractor parses surah headers and inline ayah numbering, strips footnotes and watermarks, and validates against known surah ayah counts.

### Step 2 — Build the SQLite database

```bash
python3 scripts/ingest/build_db.py
# → Output: data/quran.db
#   - quran_surah table (114 rows)
#   - quran_ayah table  (6,236 rows)
#   - quran_fts virtual table (FTS5 full-text search with porter tokenizer)
```

### Step 3 — Start ChromaDB and seed the vector index

```bash
# Start ChromaDB (Docker)
docker compose up -d chroma

# Seed the BGE-small vector index (384-dim, used for primary retrieval)
python3 scripts/ingest/build_index.py
# → Collection: "quran_v2" in ChromaDB

# (Optional) Seed the BGE-base index (768-dim, used for RRF upgrade pipeline)
python3 scripts/ingest/build_index_base.py
# → Collection: "base_quran_v2"
```

### Step 4 — Run the Bayyinah tafseer scraper (optional)

See [Section 10 — Bayyinah Tafseer Scraper](#10-bayyinah-tafseer-scraper) for full setup instructions.

```bash
cd tools/bayyinah-scraper
pip install -r requirements.txt
python -m uiautomator2 init

# Connect Android device with USB debugging enabled, then:
python run.py
# → Output: data/quran-with-tafsir.db
```

### Step 5 — Configure environment

```bash
cp .env.example apps/web/.env.local
# Edit apps/web/.env.local with your API keys
```

At minimum set `ANTHROPIC_API_KEY` (for query reformulation).

### Step 6 — Start the web app

```bash
# Docker services (ChromaDB, Valkey, MongoDB)
docker compose up -d

# Install JS dependencies
cd apps/web && npm install

# Run dev server
cd apps/web && npm run dev
# → App available at http://localhost:3000
```

### Step 7 — Verify with smoke test

```bash
# API-level smoke test (from repo root)
bash scripts/smoke_test.sh

# Integration tests
make test
```

### One-Line Setup (Makefile)

```bash
make install    # pip install + npm install
make ingest     # PDF → JSON → SQLite → ChromaDB (BGE-small, 384-dim)
make ingest-base  # (Optional) BGE-base index (768-dim)
make dev        # docker compose up + npm run dev
make smoke      # Smoke test
```

---

## 2. Running the App Day-to-Day

### Development

```bash
# Start all services + Next.js dev server
make dev

# Or manually:
docker compose up -d                  # ChromaDB + Valkey + MongoDB
cd apps/web && npm run dev            # Next.js on :3000
```

### Ingest Changes

If the PDF or indexing logic changes, re-run the full pipeline:

```bash
make ingest-all   # Clean build: PDF → SQLite → both ChromaDB collections
```

### Run Tests

```bash
make test   # Python ingest tests + Jest web tests
```

### Bayyinah Scraper

```bash
# Check how many ayahs are scraped
cd tools/bayyinah-scraper && python run.py --status

# Run/full scrape (auto-resumes from progress.json)
python run.py

# Re-scrape only problematic ayahs
python run.py --refetch

# Resume an interrupted refetch
python run.py --refetch --resume
```

---

## 3. Pipeline Reference

### 3.1 Local File Layout

```
QuranSays/
├── apps/web/                    # Next.js application
│   ├── app/
│   │   ├── api/
│   │   │   ├── chat/route.ts    # POST — Chat Q&A
│   │   │   ├── verse/[chapter]/[verse]/route.ts  # GET — Ayah explanation
│   │   │   ├── reformulate/route.ts   # POST — Query reformulation only
│   │   │   ├── compare/route.ts       # POST — Pipeline comparison
│   │   │   ├── cache/clear/route.ts   # POST — Flush semantic cache
│   │   │   ├── health/route.ts        # GET — Service health
│   │   │   └── chats/                 # Load/save chat history
│   │   ├── [chapter]/            # Chapter listing page
│   │   ├── [chapter]/[verse]/    # Verse detail page  (/2/255)
│   │   └── chat/                 # Chat UI
│   └── lib/
│       ├── chroma.ts         # ChromaDB client, embedding micro-batching, cache collection
│       ├── retrieval.ts      # Hybrid retrieval (FTS × 0.4 + Semantic × 0.6), RRF pipeline
│       ├── llm.ts            # LLM calls: chat, clarification, verse, reformulation
│       ├── db.ts             # SQLite access + Islamic synonym expansion + FTS search
│       ├── cache.ts          # Two-tier semantic cache (Valkey + ChromaDB)
│       ├── validator.ts      # Citation validation and response builder
│       └── types.ts          # Shared TypeScript types and interfaces
├── scripts/ingest/           # Python ingestion pipeline
│   ├── extract_pdf.py        # PDF → ayahs.json
│   ├── build_db.py           # ayahs.json → quran.db (SQLite + FTS5)
│   ├── build_index.py        # quran.db → ChromaDB "quran_v2" (BGE-small, 384-dim)
│   ├── build_index_base.py   # quran.db → ChromaDB "base_quran_v2" (BGE-base, 768-dim)
│   ├── validate.py           # Validate ayah extraction completeness
│   └── test_ingest.py        # Pytest tests for ingest pipeline
├── tools/bayyinah-scraper/   # ADB scraper for Bayyinah app tafseer
├── data/                     # All persistent data (SQLite DBs, ChromaDB files, JSON)
├── infra/                    # AWS Terraform (ECS, ALB, EFS, RAG cache)
├── docker-compose.yml        # ChromaDB + Valkey + MongoDB services
└── Makefile                  # Convenience targets
```

### 3.2 Data Flow

```
                           ┌─────────────────────────────┐
                           │ The Clear Quran PDF         │
                           │ Docs/the-clear-quran-...pdf │
                           └─────────────────────────────┘
                                       │
                            extract_pdf.py  (PDF → ayahs.json)
                                       │
                                       ▼
                              ┌─────────────────────┐
                              │   ayahs.json        │
                              │  6,236 ayat records │
                              └─────────────────────┘
                                       │
                            build_db.py  (JSON → SQLite)
                                       │
                                       ▼
                        ┌───────────────────────────┐
                        │       quran.db             │
                        │  ┌─────────────┐          │
                        │  │ quran_surah │ 114 rows  │
                        │  ├─────────────┤          │
                        │  │ quran_ayah  │ 6,236     │
                        │  ├─────────────┤          │
                        │  │ quran_fts   │ FTS5 idx  │
                        │  └─────────────┘          │
                        └───────────────────────────┘
                        │                     │
        build_index.py  │           build_index_base.py
        (Python, BGE-small)          (Python, BGE-base)
                        │                     │
                        ▼                     ▼
               ┌──────────────────┐  ┌──────────────────────┐
               │  ChromaDB        │  │  ChromaDB            │
               │  quran_v2        │  │  base_quran_v2       │
               │  384-dim cosine  │  │  768-dim cosine      │
               │  primary/search  │  │  upgrade/RRF pipeline │
               └──────────────────┘  └──────────────────────┘
                                       │
                        (optional)     │
               ┌───────────────────────────────┐
               │ Bayyinah Scraper (ADB)        │
               │ → quran-with-tafsir.db        │
               └───────────────────────────────┘
                                       │
                                       ▼
                        ┌───────────────────────────┐
                        │  quran-with-tafsir-data   │
                        │  .db (description_reworded)│
                        └───────────────────────────┘
                                       │
                                       ▼
                     These DBs are read by apps/web/lib/db.ts
                     at runtime to serve chat & verse endpoints.
```

---

## 4. Infrastructure Architecture

### 4.1 Service Overview

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Next.js App  │◄──►│  ChromaDB    │    │  Valkey       │    │  MongoDB     │
│  (port 3000)  │    │  (port 8000) │    │  (port 6379)  │    │  (port 27017)│
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
      │                   │                    │
      │          Vector search          L1 cache (exact)
      │          + L2 semantic          + chat history
      │          cache (paraphrase)     (Valkey/Redis)
      │
      ▼
┌──────────────────────────────────────────────────────┐
│  SQLite (on-disk)                                    │
│  data/quran.db — canonical ayah text + FTS5 index    │
│  data/quran-with-tafsir-data.db — Bayyinah tafsir    │
└──────────────────────────────────────────────────────┘
```

### 4.2 Deployment (AWS ECS — via infra/terraform)

The `infra/` directory contains Terraform config that provisions:

- **ECS Fargate** — runs the Next.js app in Docker
- **ALB** — Application Load Balancer with SSL
- **EFS** — HuggingFace model cache mount (avoids re-downloading BGE models on every deploy)
- **S3** — Terraform state backend

Docker build:

```bash
docker build -f apps/web/Dockerfile -t quransays-web apps/web/
```

---

## 5. Retrieval & RAG Pipeline

### 5.1 Current Pipeline (Production)

The retrieval orchestrator lives in `apps/web/lib/retrieval.ts`.

```
User Question → queryCollection() in retrieval.ts
    │
    ├── 1. Query Expansion (expandQueryForSemantic)
    │     ┌────────────────────────────────────────────┐
    │     │ Replaces Arabic/transliterated Islamic      │
    │     │ terms with English synonyms (e.g. "sabr"    │
    │     │ → "patience patient persevere endure")      │
    │     │ Maps: jihad, salah, zakat, hajj, tawheed,  │
    │     │ shirk, kufr, nifaq, riba, sabr, etc.       │
    │     │ ~70 Islamic terms in ISLAMIC_SYNONYMS map   │
    │     └────────────────────────────────────────────┘
    │
    ├── 2. Dual Retrieval (parallel)
    │     ├── FTS5 (SQLite): searchFTS(query, 20)
    │     │   - Porter tokenizer, stop-word filtered
    │     │   - Islamic synonym expansion on tokens
    │     │   - Returns up to 20 ayahs ranked by BM25-like rank
    │     │
    │     └── ChromaDB vector: queryCollection(expandedQuery, 20)
    │         - BGE-small-en-v1.5 (384-dim, ONNX via @xenova/transformers)
    │         - Cosine distance → similarity score (1 - d/2)
    │         - Query prefixed: "Represent this sentence for searching relevant passages: "
    │         - Returns up to 20 ayahs with distance
    │
    ├── 3. Score Fusion (weighted)
    │     FTS_weight  = 0.4
    │     SEM_weight  = 0.6
    │     Score = FTS_score × 0.4 + Semantic_score × 0.6
    │
    ├── 4. Threshold Filter + Top-K
    │     SCORE_THRESHOLD = 0.15
    │     TOP_K = 10
    │     Keep only results where combined_score >= 0.15
    │
    ├── 5. Confidence Classification
    │     HIGH   = top_score >= 0.38
    │     MEDIUM = top_score >= 0.20
    │     LOW    = top_score <  0.20
    │     NONE   = zero ayahs
    │
    └── 6. EvidenceBundle returned to chat API
          { ayahs: EvidenceAyah[], hitCount, confidence, _debug }
```

### 5.2 Embedding Micro-Batching

In `apps/web/lib/chroma.ts`, concurrent requests that arrive in the same event-loop tick are coalesced into a single ONNX forward pass:

```
10 concurrent requests → all await Valkey (~2ms)
→ all resolve in one TCP read
→ all call embed() in same microtask
→ one ONNX batch of 10 (~120ms) instead of 10× serial (~1s)
```

This gives ~10× throughput improvement under load without any batching infrastructure.

### 5.3 RRF Upgrade Pipeline (Experimental)

A `retrieveRRF()` function in `retrieval.ts` implements Reciprocal Rank Fusion:

```
RRF_score(doc) = Σ 1/(60 + rank_i)

Ranks from:
  - FTS5 (SQLite, top 20)
  - BGE-base vector search (ChromaDB base_quran_v2, 768-dim, top 20)

RRF_K = 60 (standard constant)
```

This is available via the `/api/compare` endpoint which runs both pipelines side-by-side.

### 5.4 Embedding Models

| Collection | Model | Dim | Purpose |
|---|---|---|---|
| `quran_v2` | `BAAI/bge-small-en-v1.5` | 384 | Primary retrieval (BGE-small, ONNX in Node.js) |
| `base_quran_v2` | `BAAI/bge-base-en-v1.5` | 768 | RRF upgrade pipeline (BGE-base, ONNX in Node.js) |
| `question_cache_v2` | `BAAI/bge-base-en-v1.5` | 768 | Semantic cache (same model, cosine threshold 0.85) |

---

## 6. Semantic Caching (Two-Tier)

Defined in `apps/web/lib/cache.ts`.

### Tier Structure

```
L1a: In-Memory LRU+TTL Cache
  └─ Capacity: 1,000 entries
  └─ TTL: 24 hours
  └─ Access: ~0ms (sync, no I/O)

L1b: Valkey (Redis-compatible KV store)
  └─ Host: localhost:6379 (Docker service valkey/valkey:8)
  └─ Maxmemory: 256mb, policy: allkeys-lru
  └─ TTL: 24 hours (SETEX)
  └─ Access: ~2ms
  └─ Survives Next.js process restarts
  └─ Falls back to in-memory only when Valkey is unavailable

L2: ChromaDB Semantic Cache (question_cache_v2)
  └─ Embedding: BGE-base (768-dim, cosine space)
  └─ Threshold: similarity ≥ 0.85
  └─ Max entries: 2,000 (oldest evicted on write)
  └─ Access: ~120-175ms
  └─ Catches paraphrases (different wording, same intent)
```

### Cache Flow

```
lookupCache(key)
  │
  ├── L1a in-memory hit → return { strategy: 'exact' }
  │
  ├── L1b Valkey hit → promote to in-memory → return { strategy: 'exact' }
  │
  ├── L2 ChromaDB semantic hit (≥0.85)
  │     → promote to L1 (Valkey + in-memory)
  │     → return { strategy: 'semantic', similarity }
  │
  └── All miss → return { strategy: 'miss' }
```

Cache is written fire-and-forget via `storeCache()` — never blocks the response.

Cache can be cleared via `POST /api/cache/clear`.

---

## 7. LLM Integration

### 7.1 Supported Providers

| Provider | Key Env Var | Models |
|---|---|---|
| **OpenCode** (default) | `ANTHROPIC_API_KEY` | minimax-m2.5-free, deepseek-v4-flash-free, nemotron-3-super-free, big-pickle |
| **Claude** (Anthropic) | `CLAUDE_API_KEY` | claude-opus-4-5, claude-sonnet-4-6, claude-haiku-4-5 |
| **OpenAI** | `OPENAI_API_KEY` | gpt-4o, gpt-4o-mini, gpt-4.1, gpt-5.1, etc. |
| **OpenRouter** | `OPENROUTER_API_KEY` | google/gemini-2.5-flash, deepseek/deepseek-chat-v3-0324, etc. |
| **Ollama** (local fallback) | — | qwen2.5:1.5b (local, last resort) |

### 7.2 LLM Functions

In `apps/web/lib/llm.ts`:

| Function | Purpose | Prompt Type |
|---|---|---|
| `generateChatResponse()` | Generate answer from evidence | System prompt + evidence JSON |
| `generateClarificationQuestion()` | Ask for more specificity when confidence < HIGH | Same + confidence |
| `generateVerseExplanation()` | Explain a specific ayah with context | Verse text + related ayahs |
| `reformulateQuery()` | Rewrite question to search keywords | "Search query optimizer" |

### 7.3 Fallback Chain

On 429 (rate limit), the system rotates through all OpenCode free models, then tries OpenAI, and finally falls back to local Ollama:

```
OpenCode Model A → 429 → OpenCode Model B → 429 → ...
→ all OpenCode exhausted → OpenAI (if configured)
→ OpenAI fails → Ollama (qwen2.5:1.5b local)
```

### 7.4 Prompt Pattern (Chat)

The chat prompt (in `buildChatPrompt`) follows this structure:

```
You are QuranSays. Answer using ONLY the evidence below.
If evidence is weak or insufficient, say so — don't fabricate.
Output valid JSON.

EVIDENCE:
Reference "2:153": "O believers! Seek help through patience and prayer..."
Reference "13:28": "Those who believe and whose hearts find comfort..."

[instructions on how to format citations, confidence, limitations]
```

JSON output is parsed with `parseWithRepair()` which handles:
- Markdown code fences (```json)
- Truncated JSON (closes unclosed braces/brackets)
- Plain-text fallback extraction (Ollama often returns prose)

---

## 8. Citation Validation

In `apps/web/lib/validator.ts`, every response goes through `validateCitations()`

### Validation Rules

1. **Reference exists**: every cited `reference` (e.g. "2:153") must be in the evidence set
2. **Quote matches**: the cited `quote` must be a substring of the ayah's `display_text`
3. **Normalization**: typographic characters (˹˺, curly quotes) are normalized before comparison
4. **Surrounding quotes stripped**: LLMs often wrap quotes in `""` — these are stripped

### Consequences

- If any citation fails validation → it's dropped from the response
- If all citations are dropped → confidence is downgraded to LOW
- If LOW confidence → the response is replaced with the fallback message:
  > "I was unable to find relevant guidance in The Clear Quran for your question."

---

## 9. Clarification Loop & Confidence Gating

When retrieval confidence is less than HIGH, the system enters a clarification loop instead of returning a weak answer.

### Flow

```
User asks question
    │
    ├── retrieval confidence = HIGH
    │     → generate answer → return (with citations)
    │
    └── retrieval confidence < HIGH (MEDIUM/LOW/NONE)
          │
          ├── clarification_round < 3
          │     → generate clarifying question with 2 options
          │     → user responds: "[User clarified: option X]"
          │     → enriched query = question + clarifications
          │     → retry retrieval → loop back
          │
          └── clarification_round >= 3
                → maxRoundsDeclineResponse:
                  "After several rounds of clarification I still could not find
                   specific enough Quranic evidence..."
```

### Safety Valve

After 3 clarification rounds, the system declines gracefully rather than forcing a low-quality answer.

### Enriched Query

Clarification markers `[User clarified: ...]` are stripped and merged into one enriched query for retrieval, giving a richer signal after multiple turns.

---

## 10. Bayyinah Tafseer Scraper

The Bayyinah scraper (`tools/bayyinah-scraper/`) automates an Android app via ADB+UIAutomator2 to extract the "Concise" commentary for all 6,236 ayahs.

### Architecture

```
run.py (CLI)
    │
    ├── scraper.py (BayyinahScraper class)
    │   ├── navigate_to_surahs_tab()
    │   ├── open_surah(N)
    │   ├── _navigate_to_ayah_marker(N, surah)
    │   ├── long_press_ayah(x, y)
    │   ├── close_popup()
    │   ├── run() — full scrape
    │   └── run_refetch() — targeted re-scrape
    │
    └── extractor.py
        ├── extract(d, expected_ayah, skip_scroll=False) — open popup, scroll to ayah
        ├── extract_full_range(d, start, end) — one-pass scroll through entire range
        ├── _scroll_popup_to_ayah(d, target) — scroll within popup to specific section
        ├── split_ayah_sections(text, start, end) — split concatenated popup text
        └── _harvest() / _collect_raw_sections() — extract per-ayah sections from hierarchy
```

### Setup

```bash
# 1. Connect Android device via USB with Developer Options + USB Debugging enabled
# 2. Install Bayyinah app on device
# 3. Install ADB tools
brew install --cask android-platform-tools

# 4. Verify device connection
adb devices

# 5. Install Python deps + uiautomator2
cd tools/bayyinah-scraper
pip install -r requirements.txt
python -m uiautomator2 init

# 6. Confirm app package
adb shell pm list packages | grep -i bayyinah
# Update APP_PACKAGE in config.py if needed (default: tv.bayyinah.quran)

# 7. Discover mode — navigate to a Quran page, long-press an ayah, then:
python run.py --discover
# Press Enter when prompted → saves ui_hierarchy.xml + screenshot
# Check VERSE_MARKER_RESOURCE_ID in config.py matches what you see
```

### Running

```bash
# Full scrape (auto-resumes)
python run.py

# Check progress
python run.py --status

# Re-scrape specific ayahs
python run.py --refetch

# Resume from a specific verse
python run.py --surah 2 --ayah 200

# Reset progress
python run.py --reset
```

### Output

Creates `data/quran-with-tafsir.db` — a copy of `quran.db` with the additional table:

```sql
CREATE TABLE ayah_descriptions (
    surah             INTEGER NOT NULL,
    ayah              INTEGER NOT NULL,
    description       TEXT    NOT NULL,
    description_range TEXT,           -- "1-3" if grouped, NULL if individual
    scraped_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (surah, ayah)
);
```

### Scraper Architecture Notes

- **Grouped ayahs**: Some ayahs share a single Concise description (e.g. 2:1-3). The scraper stores the same text for all ayahs in the range with `description_range = "1-3"`.
- **Popup interaction**: The Bayyinah app uses a BottomSheetDialog with a RecyclerView. The scraper uses `uiautomator2` (ADB) to scroll within the popup and extract visible text from the accessibility tree.
- **Cache eviction**: On cache miss (incomplete extraction), the scraper uses targeted scroll fallback rather than re-extracting the full range.
- **Stall detection**: Fingerprint-based stall detection filters out transitional empty states during RecyclerView ViewHolder recycling.

### Rewrite Descriptions

After scraping, descriptions can be reworded for consistency:

```bash
cd tools/rewrite-descriptions
python rewrite.py
# → Adds description_reworded column to quran-with-tafsir-data.db
```

---

## 11. Database Schema

### `data/quran.db` (Canonical Store)

**`quran_surah`**
| Column | Type | Description |
|---|---|---|
| `surah` | INTEGER PK | Surah number (1-114) |
| `name_en` | TEXT | English surah name |
| `ayah_count` | INTEGER | Number of ayahs in this surah |

**`quran_ayah`**
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `surah` | INTEGER FK | References quran_surah.surah |
| `ayah` | INTEGER | Ayah number within surah |
| `reference` | TEXT UNIQUE | e.g. "2:255" |
| `text` | TEXT | Raw ayah text (for search) |
| `display_text` | TEXT | UI-ready ayah text (preserves formatting) |
| `tokens_count` | INTEGER | Word count |

**`quran_fts`** (FTS5 virtual table)
| Column | Type |
|---|---|
| `reference` | TEXT |
| `text` | TEXT |

Tokenized with `porter ascii`.

### `data/quran-with-tafsir-data.db` (Tafseer + Rewrites)

Copy of `quran.db` with additional tables:

**`ayah_descriptions`**
| Column | Type | Description |
|---|---|---|
| `surah` | INTEGER PK | |
| `ayah` | INTEGER PK | |
| `description` | TEXT | Bayyinah Concise description (raw scraped) |
| `description_range` | TEXT | NULL or "1-3" (grouped ayahs) |
| `description_reworded` | TEXT | LLM-rewritten version for consistency |
| `scraped_at` | DATETIME | |

---

## 12. Deployment (AWS ECS)

Managed via Terraform in `infra/`.

```
├── infra/
│   ├── main.tf           # ECS cluster, service, task definition
│   ├── networking.tf     # VPC, subnets, ALB, security groups
│   ├── ecr.tf            # ECR repository
│   ├── efs.tf            # EFS filesystem (HF model cache)
│   ├── alb.tf            # Application Load Balancer + HTTPS listener
│   ├── iam.tf            # IAM roles for ECS task, ECR, etc.
│   ├── iam-github-actions.tf  # GitHub Actions OIDC → AWS
│   ├── monitoring.tf     # CloudWatch alarms
│   ├── secrets.tf        # Secrets Manager (API keys)
│   ├── s3.tf             # Terraform state backend
│   ├── variables.tf
│   └── terraform.tfvars.example
```

Key deployment characteristics:
- **EFS mount**: `/root/.cache/huggingface` for BGE model cache (avoids re-download on every deploy)
- **Container**: The Dockerfile at `apps/web/Dockerfile` builds the Next.js app for production
- **ChromaDB**: Not co-located with ECS — uses the local Docker Compose setup for development; production uses a managed ChromaDB deployment

---

## 13. Environment Variables Reference

| Variable | Default | Required | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | — | Yes | API key for opencode.ai (query reformulation + default chat) |
| `ANTHROPIC_BASE_URL` | `https://opencode.ai/zen` | No | Base URL for OpenCode/Anthropic-compatible endpoint |
| `ANTHROPIC_MODEL` | `minimax-m2.5-free` | No | Default model for reformulation |
| `CLAUDE_API_KEY` | — | No | Claude provider API key |
| `OPENAI_API_KEY` | — | No | OpenAI provider API key |
| `OPENAI_FALLBACK_MODEL` | `gpt-4o-mini` | No | Fallback model when OpenCode is rate-limited |
| `OPENROUTER_API_KEY` | — | No | OpenRouter provider API key |
| `CHROMA_URL` | `http://localhost:8000` | No | ChromaDB HTTP endpoint |
| `VALKEY_URL` | — | No | Valkey/Redis URL for L1 cache (omit for in-memory only) |
| `DB_PATH` | `../../data/quran.db` | No | Path to quran.db (relative to apps/web/) |
| `TAFSIR_DB_PATH` | `../../data/quran-with-tafsir-data.db` | No | Path to tafseer DB |
| `NEXT_PUBLIC_BASE_URL` | — | No | Base URL for SSR fetches |
| `OLLAMA_HOST` | `http://localhost:11434` | No | Ollama endpoint (last-resort fallback) |
| `OLLAMA_MODEL` | `qwen2.5:1.5b` | No | Ollama model for fallback |
| `MONGODB_URI` | — | No | MongoDB URI for chat history persistence |

---

## Appendix A: Code Map (Key Functions)

| File | Function/Export | Purpose |
|---|---|---|
| `apps/web/lib/retrieval.ts` | `retrieve()` | Main hybrid retrieval (FTS × 0.4 + Semantic × 0.6) |
| `apps/web/lib/retrieval.ts` | `retrieveRRF()` | RRF-based retrieval (FTS + BGE-base) |
| `apps/web/lib/chroma.ts` | `queryCollection()` | BGE-small vector search |
| `apps/web/lib/chroma.ts` | `queryCollectionBase()` | BGE-base vector search |
| `apps/web/lib/chroma.ts` | `embedQuery()` / `embedQueryBase()` | Embed with micro-batching |
| `apps/web/lib/db.ts` | `searchFTS()` | FTS5 full-text search with Islamic synonym expansion |
| `apps/web/lib/db.ts` | `expandQueryForSemantic()` | Query expansion (Arabic→English synonyms) |
| `apps/web/lib/db.ts` | `expandReformulation()` | Expand reformulated keywords (bidirectional Arabic↔English) |
| `apps/web/lib/llm.ts` | `generateChatResponse()` | LLM chat with evidence grounding |
| `apps/web/lib/llm.ts` | `generateClarificationQuestion()` | Ask clarifying question |
| `apps/web/lib/llm.ts` | `generateVerseExplanation()` | Explain a single ayah |
| `apps/web/lib/llm.ts` | `reformulateQuery()` | Rewrite question → search keywords |
| `apps/web/lib/cache.ts` | `lookupCache()` | Two-tier cache lookup (L1+L2) |
| `apps/web/lib/cache.ts` | `storeCache()` | Fire-and-forget cache write |
| `apps/web/lib/validator.ts` | `validateCitations()` | Verify citation quotes against stored ayah text |
| `apps/web/lib/validator.ts` | `buildChatResponse()` | Assemble validated ChatResponse |
| `scripts/ingest/extract_pdf.py` | `extract_pages()` | PDF text extraction with pdfplumber |
| `scripts/ingest/build_db.py` | `create_schema()` | SQLite schema + FTS5 |
| `scripts/ingest/build_index.py` | `main()` | ChromaDB index build (BGE-small) |
| `tools/bayyinah-scraper/scraper.py` | `BayyinahScraper.run()` | Full tafseer scrape |
| `tools/bayyinah-scraper/extractor.py` | `extract_full_range()` | One-pass range extraction |
| `tools/bayyinah-scraper/extractor.py` | `extract()` | Per-ayah popup extraction |
