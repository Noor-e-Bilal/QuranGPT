# ── Stage 1: Install all dependencies ────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY apps/web/package*.json ./
RUN npm ci

# ── Stage 2: Build the Next.js application ────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy node_modules from the deps stage (already compiled for Alpine in that stage)
# and prune devDependencies in-place to keep the image lean.
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web/package*.json ./
RUN npm prune --production

# Copy build artefacts
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package*.json ./

# Bundle the Quran SQLite database (7 MB) and pre-built ChromaDB seed data (74 MB)
# directly in the image so the app runs without an EFS dependency.
# The init container copies the chroma-seed into the shared ephemeral volume
# before the ChromaDB sidecar starts.
COPY data/quran.db /app/data/quran.db
COPY data/chroma/ /app/data/chroma-seed/

RUN mkdir -p /root/.cache/huggingface

EXPOSE 3000
ENV PORT=3000
# DB_PATH points to the bundled SQLite — no EFS mount needed
ENV DB_PATH=/app/data/quran.db

CMD ["npm", "start"]
