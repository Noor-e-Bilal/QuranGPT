# QuranSays

A Quran-grounded Q&A application. Every answer is sourced exclusively from **The Clear Quran** (Dr. Mustafa Khattab's thematic English translation) with direct ayah citations. Ask any question — Islam has guidance on everything.

---

## Features

| Feature | Description |
|---|---|
| 💬 **Chat** | Ask anything; get answers backed by quoted ayahs with surah/verse references |
| 🔄 **Query Reformulation** | Your question is automatically rewritten by `minimax-m2.5-free` into a precise retrieval query (max 30 words) |
| 🔍 **Clarification** | Ambiguous questions trigger follow-up options before answering |
| 🎛️ **Provider Selector** | Switch between Claude, OpenAI, OpenRouter, and minimax — with model dropdown and temperature control |
| 🔬 **Debug Panel** | Click the 🔬 icon on any answer to inspect retrieval scores, the exact prompt sent to the LLM, and raw response |
| 📊 **Pipeline Comparison** | Toggle "Compare Pipelines" to see both retrieval approaches side-by-side (ChatGPT-style) |
| 📖 **Verse Pages** | `/{surah}/{ayah}` shows the ayah text with a contextual explanation |
| ⚡ **Caching** | Repeated questions are served instantly from an in-memory cache |
| 🔒 **Source Policy** | The LLM is strictly grounded — no answer without Quranic evidence |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend / API | Next.js 14 (App Router, TypeScript) |
| Vector search | ChromaDB (Docker) — dual collections: `quran_v2` (BGE-small) + `base_quran_v2` (BGE-base) |
| Full-text search | SQLite FTS5 |
| Embeddings (current) | `BAAI/bge-small-en-v1.5` (384-dim) |
| Embeddings (upgrade) | `BAAI/bge-base-en-v1.5` (768-dim) |
| LLM — reformulation | `minimax-m2.5-free` via [opencode.ai](https://opencode.ai) |
| LLM — answers | Claude / OpenAI / OpenRouter / minimax (user-selectable) |
| PDF ingestion | pdfplumber (Python) |
| Infrastructure | AWS ECS Fargate + EFS + ALB (Terraform — see `infra/`) |

### Supported LLM Providers

| Provider | Models |
|---|---|
| **minimax** (opencode.ai) | `minimax-m2.5-free` *(default)* |
| **Claude** (Anthropic) | `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5` |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `gpt-4.1` |
| **OpenRouter** | `google/gemini-2.5-flash-preview:free`, `meta-llama/llama-4-maverick:free`, `deepseek/deepseek-r1:free` |

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18+ |
| Python | 3.9+ |
| Docker | any recent |
| Terraform | 1.5+ *(AWS deployment only)* |

---

## First-Time Setup

### 1. Clone the repo

```bash
git clone https://github.com/Noor-e-Bilal/QuranSays.git
cd QuranSays
```

### 2. Configure environment variables

```bash
cp .env.example apps/web/.env.local
```

Open `apps/web/.env.local` and fill in the API keys you intend to use:

```env
# Reformulation LLM (required — used for every query)
ANTHROPIC_BASE_URL=https://opencode.ai/zen
ANTHROPIC_MODEL=minimax-m2.5-free
ANTHROPIC_API_KEY=<your-opencode-api-key>

# Optional — only needed if you select that provider in the UI
CLAUDE_API_KEY=<your-anthropic-api-key>
OPENAI_API_KEY=<your-openai-api-key>
OPENROUTER_API_KEY=<your-openrouter-api-key>

CHROMA_URL=http://localhost:8000
DB_PATH=../../data/quran.db
```

> Get your opencode.ai key at [opencode.ai](https://opencode.ai) → Dashboard → API Keys.

### 3. Install dependencies

```bash
make install
```

### 4. Place the source PDF

```
Docs/the-clear-quran-a-thematic-english-translation.pdf
```

> The PDF is not committed for copyright reasons. Contact the maintainer if you need it.

### 5. Run the ingestion pipeline

Extracts all 6,236 ayahs, builds the SQLite/FTS5 database, and generates ChromaDB embeddings. **Run once; ~5 minutes for the small model.**

```bash
# Start ChromaDB first
docker compose up -d chroma

# Build SQLite DB + BGE-small (384-dim) ChromaDB collection
make ingest

# Build BGE-base (768-dim) collection — needed for Pipeline Comparison (~10 min)
make ingest-base
```

> Verify ingestion:
> ```bash
> python3 -c "import sqlite3; c=sqlite3.connect('data/quran.db'); print(c.execute('SELECT COUNT(*) FROM quran_ayah').fetchone())"
> # Expected: (6236,)
> ```

---

## Running the App

```bash
make dev
```

Starts ChromaDB (Docker) + Next.js at **[http://localhost:3000](http://localhost:3000)**.

---

## All Commands

| Command | Description |
|---|---|
| `make install` | Install Python + Node dependencies |
| `make ingest` | PDF → SQLite DB → BGE-small ChromaDB index (`quran_v2`) |
| `make ingest-base` | Build BGE-base ChromaDB index (`base_quran_v2`) for comparison pipeline |
| `make ingest-all` | Run both `ingest` and `ingest-base` |
| `make dev` | Start ChromaDB + Next.js dev server |
| `make test` | Python ingest tests + Jest unit tests |
| `make smoke` | 9 end-to-end smoke tests against `localhost:3000` |
| `make clean` | Delete generated data and `.next` build cache |

---

## Project Structure

```
QuranSays/
├── apps/
│   └── web/                          # Next.js application
│       ├── Dockerfile                # Multi-stage production image
│       ├── app/
│       │   ├── page.tsx              # Chat UI (provider selector, comparison toggle)
│       │   ├── [chapter]/[ayah]/     # Verse pages — /{surah}/{ayah}
│       │   ├── components/
│       │   │   ├── ComparisonView.tsx  # Side-by-side pipeline comparison UI
│       │   │   └── DebugPanel.tsx      # Tabbed debug popup (current + upgrade data)
│       │   └── api/
│       │       ├── chat/route.ts       # POST /api/chat — main Q&A endpoint
│       │       ├── compare/route.ts    # POST /api/compare — upgrade pipeline
│       │       ├── reformulate/route.ts# POST /api/reformulate — query rewrite
│       │       ├── verse/[surah]/[ayah]/route.ts
│       │       └── health/route.ts
│       └── lib/
│           ├── llm.ts               # LLM caller, provider routing, prompt builder
│           ├── retrieval.ts         # Hybrid retrieval: FTS + semantic (current + RRF upgrade)
│           ├── db.ts                # SQLite queries + FTS5
│           ├── chroma.ts            # ChromaDB client (dual-collection aware)
│           ├── cache.ts             # In-memory response cache (5-min TTL)
│           ├── validator.ts         # LLM output validation + citation checker
│           └── types.ts             # Shared TypeScript types
├── scripts/
│   ├── ingest/
│   │   ├── extract_pdf.py           # PDF → ayahs.json
│   │   ├── build_db.py              # ayahs.json → quran.db (SQLite + FTS5)
│   │   ├── build_index.py           # quran.db → quran_v2 (BGE-small, 384-dim)
│   │   ├── build_index_base.py      # quran.db → base_quran_v2 (BGE-base, 768-dim)
│   │   └── validate.py              # Sanity-checks extracted data
│   └── smoke_test.sh                # 9 end-to-end smoke tests
├── infra/                           # Terraform — AWS ECS Fargate deployment
│   ├── versions.tf                  # Provider + Terraform version constraints
│   ├── variables.tf                 # All input variables
│   ├── locals.tf                    # Computed values and name prefixes
│   ├── networking.tf                # VPC, subnets, IGW, NAT, security groups
│   ├── ecr.tf                       # ECR repository for the web image
│   ├── efs.tf                       # EFS filesystem + access points (sqlite, chroma, model-cache)
│   ├── iam.tf                       # ECS execution + task IAM roles
│   ├── secrets.tf                   # Secrets Manager entries for API keys
│   ├── ecs.tf                       # ECS cluster, task definition, service
│   ├── alb.tf                       # Application Load Balancer (HTTP; HTTPS stub included)
│   ├── monitoring.tf                # CloudWatch log groups + optional alarms
│   ├── outputs.tf                   # ALB DNS, ECR URL, EFS ID, secret ARNs
│   └── terraform.tfvars.example     # Copy to terraform.tfvars and fill in values
├── data/
│   ├── quran.db                     # SQLite DB (gitignored — generated by ingest)
│   └── chroma/                      # ChromaDB storage (gitignored — generated by ingest)
├── Docs/
│   └── the-clear-quran-*.pdf        # Source PDF (not committed)
├── docker-compose.yml               # ChromaDB service for local dev
├── Makefile                         # Dev workflow shortcuts
└── .env.example                     # Environment variable template
```

---

## How It Works

```
User question
      │
      ▼
1. Reformulation ── minimax-m2.5-free rewrites the question
      │              into a precise ≤30-word retrieval query
      ▼
2. Clarification ── If the query is still ambiguous, the LLM
      │              returns 2-3 follow-up options instead of answering
      ▼
3. Retrieval ─────── Hybrid search against SQLite FTS5 + ChromaDB
      │              Current:  FTS×0.4 + Semantic×0.6 (BGE-small)
      │              Upgrade:  RRF fusion (BGE-base, 768-dim)
      ▼
4. Generation ─────── Top-ranked ayahs are injected into the LLM prompt.
      │              The model answers strictly from provided evidence
      │              and cites specific ayahs.
      ▼
5. Caching ─────────── Completed answers cached 5 min (keyed on question)
```

---

## Pipeline Comparison

Toggle **"Compare Pipelines"** in the sidebar to see both retrieval approaches answer your question simultaneously, side-by-side — similar to ChatGPT's A/B mode:

| | Current Pipeline (left) | Upgrade Pipeline (right) |
|---|---|---|
| **Embedding model** | `BAAI/bge-small-en-v1.5` (384-dim) | `BAAI/bge-base-en-v1.5` (768-dim) |
| **ChromaDB collection** | `quran_v2` | `base_quran_v2` |
| **Score fusion** | FTS×0.4 + Semantic×0.6 | Reciprocal Rank Fusion (RRF) |
| **Same LLM** | ✅ | ✅ |

> Both pipelines use the same provider/model selected in the sidebar — the only difference is how evidence is retrieved and ranked.

---

## Debug Panel

Click the **🔬 icon** on any answer bubble to open the Debug Panel:

- **Current Pipeline tab** — meta (timestamp, clarification round, safety valve), retrieval scores table (FTS × Semantic × Combined), enriched query, collapsible LLM prompt and raw response
- **Upgrade Pipeline tab** *(comparison mode only)* — RRF scores table (FTS rank, semantic rank, RRF score), BGE-base embedding model, collapsible LLM data

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | opencode.ai API key (query reformulation) |
| `ANTHROPIC_BASE_URL` | ✅ | LLM endpoint (`https://opencode.ai/zen`) |
| `ANTHROPIC_MODEL` | ✅ | Reformulation model (`minimax-m2.5-free`) |
| `CLAUDE_API_KEY` | Optional | Anthropic Claude API key |
| `OPENAI_API_KEY` | Optional | OpenAI API key |
| `OPENROUTER_API_KEY` | Optional | OpenRouter API key |
| `CHROMA_URL` | ✅ | ChromaDB URL (`http://localhost:8000`) |
| `DB_PATH` | ✅ | Path to SQLite DB (relative to `apps/web/`) |
| `NEXT_PUBLIC_BASE_URL` | Optional | Override for internal SSR fetch base URL |

---

## AWS Deployment

The `infra/` directory contains a complete Terraform configuration for deploying QuranSays on AWS using **ECS Fargate + EFS + ALB**.

### Architecture

```
Internet ──► Route53 ──► CloudFront (optional)
                              │
                              ▼
                     ALB (public subnets)
                              │
                              ▼
                    ECS Fargate Task (private subnets)
                    ┌─────────────────────────────────┐
                    │  web container (Next.js :3000)  │
                    │  chroma sidecar (:8000)         │
                    └──────────┬──────────────────────┘
                               │ EFS mount
                    ┌──────────▼──────────────────────┐
                    │  EFS Filesystem                  │
                    │  /sqlite    — quran.db           │
                    │  /chroma    — vector data        │
                    │  /model-cache — ONNX models      │
                    └──────────────────────────────────┘
```

Secrets Manager stores all four API keys and injects them as environment variables at task launch.

### Deploy Steps

```bash
cd infra

# 1. Init Terraform
terraform init

# 2. Create ECR repo first (before pushing the image)
terraform apply -target=aws_ecr_repository.web

# 3. Build and push the Docker image
ECR_URL=$(terraform output -raw ecr_repository_url)
ECR_REGISTRY=${ECR_URL%%/*}   # strip repo path — docker login needs registry host only
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_REGISTRY
docker build -t $ECR_URL:latest ../apps/web
docker push $ECR_URL:latest

# 4. Set your web_image variable and populate secrets
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: set web_image = "$ECR_URL:latest"

# 5. Deploy all remaining infrastructure
terraform apply

# 6. Set API keys in Secrets Manager
terraform output -json secret_arns | python3 -c "
import sys, json
arns = json.load(sys.stdin)
for name, arn in arns.items():
    print(f'aws secretsmanager put-secret-value --secret-id {arn} --secret-string YOUR_{name.upper()}_KEY')
"

# 7. Run the ingestion job (mount EFS using AWS DataSync or an EC2 helper instance)
# Then force a new ECS deployment to pick up the data:
aws ecs update-service --cluster quransays-prod-cluster \
  --service quransays-prod-svc --force-new-deployment

# 8. Get the app URL
terraform output alb_dns_name
```

> **HTTPS**: Uncomment the `aws_lb_listener.https` block in `infra/alb.tf` once you have an ACM certificate ARN, and add `var.certificate_arn` to `variables.tf`.

---

## Smoke Tests

With the dev server running (`make dev`):

```bash
make smoke
```

Expected:
```
Results: 9 passed, 0 failed
```

---

## License

Private repository — © Noor-e-Bilal. All rights reserved.

