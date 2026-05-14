# ── Stage 1: Install all dependencies ────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Stage 2: Build the Next.js application ────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
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
COPY package*.json ./
RUN npm prune --production

# Copy build artefacts
COPY --from=builder /app/.next ./.next
# public/ is optional — only copy if it exists (Next.js creates it for static assets)
COPY --from=builder /app/package*.json ./

# EFS mount points (provisioned by Terraform):
#   /mnt/sqlite              → SQLite DB (quran.db placed here by ingestion job)
#   /root/.cache/huggingface → @xenova/transformers ONNX model cache (avoids re-download on restart)
RUN mkdir -p /mnt/sqlite /root/.cache/huggingface

EXPOSE 3000
ENV PORT=3000

CMD ["npm", "start"]
