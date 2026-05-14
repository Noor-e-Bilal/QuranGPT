"""
build_index_base.py — Populate ChromaDB with ayahs using BAAI/bge-base-en-v1.5.

Produces collection 'base_quran_v2' (768-dim cosine embeddings).
The existing 'quran_v2' collection (BGE-small, 384-dim) is left untouched.

Requires:
  - ChromaDB running:  docker compose up -d chroma
  - Model installed:   pip3 install sentence-transformers>=2.7.0

Run from repo root:
    python3 scripts/ingest/build_index_base.py
"""

import json
import os
import sqlite3
import sys
from pathlib import Path
from urllib.parse import urlparse

try:
    import chromadb
    from tqdm import tqdm
except ImportError:
    sys.exit("ERROR: chromadb/tqdm not installed. Run: pip3 install chromadb tqdm")

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    sys.exit(
        "ERROR: sentence-transformers not installed. "
        "Run: pip3 install sentence-transformers>=2.7.0"
    )

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "data" / "quran.db"
INDEX_META_PATH = ROOT / "data" / "index_meta_base.json"

CHROMA_URL = os.environ.get("CHROMA_URL", "http://localhost:8000")
COLLECTION_NAME = "base_quran_v2"
EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"
BATCH_SIZE = 32  # Smaller batches — base model is ~3× larger than small


def load_ayahs(db_path: Path) -> list[dict]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT surah, ayah, reference, display_text FROM quran_ayah ORDER BY surah, ayah"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def main() -> None:
    if not DB_PATH.exists():
        sys.exit(f"ERROR: {DB_PATH} not found. Run build_db.py first.")

    print(f"Loading embedding model '{EMBEDDING_MODEL}' …")
    model = SentenceTransformer(EMBEDDING_MODEL)
    dim = model.get_sentence_embedding_dimension()
    print(f"  Model loaded (dim={dim})")

    print(f"Connecting to ChromaDB at {CHROMA_URL} …")
    parsed = urlparse(CHROMA_URL)
    chroma_host = parsed.hostname or "localhost"
    chroma_port = parsed.port or 8000
    client = chromadb.HttpClient(host=chroma_host, port=chroma_port)
    try:
        client.heartbeat()
    except Exception as e:
        sys.exit(
            f"ERROR: Cannot connect to ChromaDB: {e}\n"
            "Is 'docker compose up -d chroma' running?"
        )

    # Reset collection if exists
    try:
        client.delete_collection(COLLECTION_NAME)
        print(f"Deleted existing collection '{COLLECTION_NAME}'")
    except Exception:
        pass

    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )
    print(f"Created collection '{COLLECTION_NAME}' (dim={dim})")

    print(f"Loading ayahs from {DB_PATH.name} …")
    ayahs = load_ayahs(DB_PATH)
    print(f"  Loaded {len(ayahs)} ayahs")

    # Encode all documents (no instruction prefix for BGE stored documents)
    print(f"Encoding {len(ayahs)} ayahs with '{EMBEDDING_MODEL}' …")
    texts = [a["display_text"] for a in ayahs]
    embeddings = model.encode(
        texts,
        normalize_embeddings=True,
        batch_size=BATCH_SIZE,
        show_progress_bar=True,
    )

    # Insert in batches
    print(f"Uploading to ChromaDB in batches of {BATCH_SIZE} …")
    for i in tqdm(range(0, len(ayahs), BATCH_SIZE)):
        batch = ayahs[i : i + BATCH_SIZE]
        batch_embeds = embeddings[i : i + BATCH_SIZE]
        collection.add(
            ids=[a["reference"] for a in batch],
            documents=[a["display_text"] for a in batch],
            embeddings=batch_embeds.tolist(),
            metadatas=[
                {
                    "surah": a["surah"],
                    "ayah": a["ayah"],
                    "text": a["display_text"][:500],
                }
                for a in batch
            ],
        )

    meta = {
        "collection": COLLECTION_NAME,
        "embedding_model": EMBEDDING_MODEL,
        "embedding_dim": dim,
        "ayah_count": len(ayahs),
        "chroma_url": CHROMA_URL,
    }
    INDEX_META_PATH.write_text(json.dumps(meta, indent=2))
    print(f"\n✓ Indexed {len(ayahs)} ayahs into '{COLLECTION_NAME}'")
    print(f"  Model: {EMBEDDING_MODEL} ({dim}-dim)")
    print(f"  Metadata saved to {INDEX_META_PATH}")


if __name__ == "__main__":
    main()
