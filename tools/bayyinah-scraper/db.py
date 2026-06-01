from __future__ import annotations
"""
Database operations for the Bayyinah scraper.

Creates data/quran-with-tafsir.db as a copy of quran.db and adds
the ayah_descriptions table.  quran.db is never modified.
"""

import shutil
import sqlite3
from datetime import datetime

import config as cfg


# ─── Setup ───────────────────────────────────────────────────────────────────

def init_db() -> sqlite3.Connection:
    """
    Create quran-with-tafsir.db if it doesn't exist (copied from quran.db),
    add the ayah_descriptions table, and return an open connection.
    """
    if not cfg.SOURCE_DB.exists():
        raise FileNotFoundError(f"Source DB not found: {cfg.SOURCE_DB}")

    if not cfg.OUTPUT_DB.exists():
        print(f"[db] Copying {cfg.SOURCE_DB.name} → {cfg.OUTPUT_DB.name}")
        shutil.copy2(cfg.SOURCE_DB, cfg.OUTPUT_DB)

    conn = sqlite3.connect(cfg.OUTPUT_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ayah_descriptions (
            surah             INTEGER NOT NULL,
            ayah              INTEGER NOT NULL,
            description       TEXT    NOT NULL,
            description_range TEXT,
            scraped_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (surah, ayah)
        )
    """)
    conn.commit()
    return conn


# ─── Reads ───────────────────────────────────────────────────────────────────

def get_surah_ayah_count(conn: sqlite3.Connection, surah: int) -> int:
    row = conn.execute(
        "SELECT ayah_count FROM quran_surah WHERE surah = ?", (surah,)
    ).fetchone()
    if row is None:
        raise ValueError(f"Surah {surah} not found in DB")
    return row["ayah_count"]


def get_surah_name(conn: sqlite3.Connection, surah: int) -> str:
    row = conn.execute(
        "SELECT name_en FROM quran_surah WHERE surah = ?", (surah,)
    ).fetchone()
    return row["name_en"] if row else f"Surah {surah}"


def already_scraped(conn: sqlite3.Connection, surah: int, ayah: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM ayah_descriptions WHERE surah = ? AND ayah = ?",
        (surah, ayah),
    ).fetchone()
    return row is not None


def scraped_count(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT COUNT(*) FROM ayah_descriptions").fetchone()
    return row[0]


# ─── Writes ──────────────────────────────────────────────────────────────────

def upsert_description(
    conn: sqlite3.Connection,
    surah: int,
    ayah: int,
    description: str,
    description_range: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO ayah_descriptions (surah, ayah, description, description_range, scraped_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(surah, ayah) DO UPDATE SET
            description       = excluded.description,
            description_range = excluded.description_range,
            scraped_at        = excluded.scraped_at
        """,
        (surah, ayah, description, description_range, datetime.utcnow().isoformat()),
    )
    conn.commit()
