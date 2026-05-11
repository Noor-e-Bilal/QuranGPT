"""
build_index.py — Populate ChromaDB with ayahs from data/quran.db.

Uses ChromaDB's built-in default embedding function (ONNX all-MiniLM-L6-v2).
Requires ChromaDB running: docker compose up -d chroma

Run from repo root:
    python3 scripts/ingest/build_index.py
"""

import json
import os
import sqlite3
import sys
from pathlib import Path

try:
    import chromadb
    from tqdm import tqdm
except ImportError:
    sys.exit("ERROR: chromadb/tqdm not installed. Run: pip3 install chromadb tqdm")

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "data" / "quran.db"
INDEX_META_PATH = ROOT / "data" / "index_meta.json"

CHROMA_URL = os.environ.get("CHROMA_URL", "http://localhost:8000")
COLLECTION_NAME = "quran_v1"
BATCH_SIZE = 100


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

    print(f"Connecting to ChromaDB at {CHROMA_URL} …")
    client = chromadb.HttpClient(host=CHROMA_URL.replace("http://", "").split(":")[0],
                                 port=int(CHROMA_URL.split(":")[-1]))

    # Test connection
    try:
        client.heartbeat()
    except Exception as e:
        sys.exit(f"ERROR: Cannot connect to ChromaDB: {e}\nIs 'docker compose up -d chroma' running?")

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
    print(f"Created collection '{COLLECTION_NAME}'")

    print(f"Loading ayahs from {DB_PATH.name} …")
    ayahs = load_ayahs(DB_PATH)
    print(f"  Loaded {len(ayahs)} ayahs")

    # Insert in batches
    print(f"Indexing {len(ayahs)} ayahs in batches of {BATCH_SIZE} …")
    for i in tqdm(range(0, len(ayahs), BATCH_SIZE)):
        batch = ayahs[i : i + BATCH_SIZE]
        collection.add(
            ids=[a["reference"] for a in batch],
            documents=[a["display_text"] for a in batch],
            metadatas=[
                {
                    "surah": a["surah"],
                    "ayah": a["ayah"],
                    "text": a["display_text"][:500],
                }
                for a in batch
            ],
        )

    # Write metadata
    meta = {
        "collection": COLLECTION_NAME,
        "ayah_count": len(ayahs),
        "chroma_url": CHROMA_URL,
    }
    INDEX_META_PATH.write_text(json.dumps(meta, indent=2))
    print(f"\n✓ Indexed {len(ayahs)} ayahs into ChromaDB collection '{COLLECTION_NAME}'")
    print(f"  Metadata saved to {INDEX_META_PATH}")


if __name__ == "__main__":
    main()
