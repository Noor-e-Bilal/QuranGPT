"""
build_db.py — Load data/ayahs.json into data/quran.db (SQLite + FTS5).

Run from repo root:
    python3 scripts/ingest/build_db.py
"""

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AYAHS_PATH = ROOT / "data" / "ayahs.json"
DB_PATH = ROOT / "data" / "quran.db"

AYAH_COUNTS = [
    7, 286, 200, 176, 120, 165, 206, 75, 129, 109,
    123, 111, 43, 52, 99, 128, 111, 110, 98, 135,
    112, 78, 118, 64, 77, 227, 93, 88, 69, 60,
    34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
    54, 53, 89, 59, 37, 35, 38, 29, 18, 45,
    60, 49, 62, 55, 78, 96, 29, 22, 24, 13,
    14, 11, 11, 18, 12, 12, 30, 52, 52, 44,
    28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
    29, 19, 36, 25, 22, 17, 19, 26, 30, 20,
    15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
    11, 8, 3, 9, 5, 4, 5, 6, 5, 8,
    3, 5, 6, 5, 3, 5, 3, 6, 3, 5,
    4, 5, 29, 15,
]

SURAH_NAMES = [
    "Al-Fatihah", "Al-Baqarah", "Ali 'Imran", "An-Nisa'", "Al-Ma'idah",
    "Al-An'am", "Al-A'raf", "Al-Anfal", "At-Tawbah", "Yunus",
    "Hud", "Yusuf", "Ar-Ra'd", "Ibrahim", "Al-Hijr",
    "An-Nahl", "Al-Isra'", "Al-Kahf", "Maryam", "Ta-Ha",
    "Al-Anbiya'", "Al-Hajj", "Al-Mu'minun", "An-Nur", "Al-Furqan",
    "Ash-Shu'ara'", "An-Naml", "Al-Qasas", "Al-'Ankabut", "Ar-Rum",
    "Luqman", "As-Sajdah", "Al-Ahzab", "Saba'", "Fatir",
    "Ya-Sin", "As-Saffat", "Sad", "Az-Zumar", "Ghafir",
    "Fussilat", "Ash-Shura", "Az-Zukhruf", "Ad-Dukhan", "Al-Jathiyah",
    "Al-Ahqaf", "Muhammad", "Al-Fath", "Al-Hujurat", "Qaf",
    "Adh-Dhariyat", "At-Tur", "An-Najm", "Al-Qamar", "Ar-Rahman",
    "Al-Waqi'ah", "Al-Hadid", "Al-Mujadila", "Al-Hashr", "Al-Mumtahanah",
    "As-Saf", "Al-Jumu'ah", "Al-Munafiqun", "At-Taghabun", "At-Talaq",
    "At-Tahrim", "Al-Mulk", "Al-Qalam", "Al-Haqqah", "Al-Ma'arij",
    "Nuh", "Al-Jinn", "Al-Muzzammil", "Al-Muddaththir", "Al-Qiyamah",
    "Al-Insan", "Al-Mursalat", "An-Naba'", "An-Nazi'at", "'Abasa",
    "At-Takwir", "Al-Infitar", "Al-Mutaffifin", "Al-Inshiqaq", "Al-Buruj",
    "At-Tariq", "Al-A'la", "Al-Ghashiyah", "Al-Fajr", "Al-Balad",
    "Ash-Shams", "Al-Layl", "Ad-Duha", "Ash-Sharh", "At-Tin",
    "Al-'Alaq", "Al-Qadr", "Al-Bayyinah", "Az-Zalzalah", "Al-'Adiyat",
    "Al-Qari'ah", "At-Takathur", "Al-'Asr", "Al-Humazah", "Al-Fil",
    "Quraysh", "Al-Ma'un", "Al-Kawthar", "Al-Kafirun", "An-Nasr",
    "Al-Masad", "Al-Ikhlas", "Al-Falaq", "An-Nas",
]


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS quran_surah (
            surah       INTEGER PRIMARY KEY,
            name_en     TEXT NOT NULL,
            ayah_count  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS quran_ayah (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            surah        INTEGER NOT NULL,
            ayah         INTEGER NOT NULL,
            reference    TEXT NOT NULL UNIQUE,
            text         TEXT NOT NULL,
            display_text TEXT NOT NULL,
            tokens_count INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (surah) REFERENCES quran_surah(surah)
        );

        CREATE INDEX IF NOT EXISTS idx_ayah_reference ON quran_ayah(reference);
        CREATE INDEX IF NOT EXISTS idx_ayah_surah_ayah ON quran_ayah(surah, ayah);

        CREATE VIRTUAL TABLE IF NOT EXISTS quran_fts USING fts5(
            reference,
            text,
            tokenize = 'porter ascii'
        );
    """)


def insert_surahs(conn: sqlite3.Connection) -> None:
    rows = [
        (i + 1, SURAH_NAMES[i], AYAH_COUNTS[i])
        for i in range(114)
    ]
    conn.executemany(
        "INSERT OR REPLACE INTO quran_surah (surah, name_en, ayah_count) VALUES (?, ?, ?)",
        rows,
    )


def insert_ayahs(conn: sqlite3.Connection, ayahs: list[dict]) -> int:
    ayah_rows = [
        (
            a["surah"],
            a["ayah"],
            a["reference"],
            a["text"],
            a["display_text"],
            len(a["text"].split()),
        )
        for a in ayahs
    ]
    conn.executemany(
        """INSERT OR REPLACE INTO quran_ayah
           (surah, ayah, reference, text, display_text, tokens_count)
           VALUES (?, ?, ?, ?, ?, ?)""",
        ayah_rows,
    )

    fts_rows = [(a["reference"], a["text"]) for a in ayahs]
    conn.executemany(
        "INSERT INTO quran_fts (reference, text) VALUES (?, ?)",
        fts_rows,
    )
    return len(ayah_rows)


def main() -> None:
    if not AYAHS_PATH.exists():
        sys.exit(f"ERROR: {AYAHS_PATH} not found. Run extract_pdf.py first.")

    with open(AYAHS_PATH) as f:
        ayahs: list[dict] = json.load(f)

    if DB_PATH.exists():
        DB_PATH.unlink()
        print(f"Removed existing {DB_PATH.name}")

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))

    try:
        print("Creating schema …")
        create_schema(conn)

        print("Inserting surahs …")
        insert_surahs(conn)

        print(f"Inserting {len(ayahs)} ayahs …")
        count = insert_ayahs(conn, ayahs)

        conn.commit()
        print(f"✓ Inserted {count} ayahs into {DB_PATH}")
    except Exception as e:
        conn.rollback()
        conn.close()
        sys.exit(f"ERROR: {e}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
