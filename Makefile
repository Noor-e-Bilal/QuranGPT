.PHONY: install ingest ingest-base ingest-all dev test smoke clean

install:
	pip3 install -r scripts/ingest/requirements.txt
	cd apps/web && npm install

ingest:
	python3 scripts/ingest/extract_pdf.py
	python3 scripts/ingest/validate.py
	python3 scripts/ingest/build_db.py
	python3 scripts/ingest/build_index.py

# Builds the BGE-base-en-v1.5 (768-dim) collection used by the upgrade pipeline.
# Requires ChromaDB running. Takes ~10 min on first run (model download + index).
ingest-base:
	python3 scripts/ingest/build_index_base.py

ingest-all: ingest ingest-base

dev:
	docker compose up -d chroma
	cd apps/web && cp -n ../../.env.example .env.local 2>/dev/null || true && npm run dev

test:
	cd scripts && python3 -m pytest ingest/test_ingest.py -v
	cd apps/web && npx jest --passWithNoTests

smoke:
	bash scripts/smoke_test.sh

clean:
	rm -f data/quran.db data/ayahs.json data/index_meta.json
	rm -rf data/chroma
	cd apps/web && rm -rf .next
