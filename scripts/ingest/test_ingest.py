"""
test_ingest.py — pytest tests for the ingestion pipeline.

Run from repo root:
    python3 -m pytest scripts/ingest/test_ingest.py -v
"""

import json
import sqlite3
from pathlib import Path

import pytest

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
    11, 8, 3, 9, 5, 4, 7, 3, 6, 3,
    5, 4, 5, 6,
]
TOTAL_EXPECTED = sum(AYAH_COUNTS)


@pytest.mark.skipif(not AYAHS_PATH.exists(), reason="ayahs.json not yet generated")
class TestAyahsJson:
    def setup_method(self):
        with open(AYAHS_PATH) as f:
            self.ayahs: list[dict] = json.load(f)

    def test_minimum_ayah_count(self):
        assert len(self.ayahs) >= 6000, f"Only {len(self.ayahs)} ayahs extracted"

    def test_no_duplicate_references(self):
        refs = [a["reference"] for a in self.ayahs]
        assert len(refs) == len(set(refs)), "Duplicate references found"

    def test_all_have_non_empty_text(self):
        empties = [a["reference"] for a in self.ayahs if not a.get("text", "").strip()]
        assert not empties, f"Empty texts: {empties[:5]}"

    def test_reference_format(self):
        for a in self.ayahs:
            parts = a["reference"].split(":")
            assert len(parts) == 2, f"Bad reference format: {a['reference']}"
            s, v = int(parts[0]), int(parts[1])
            assert 1 <= s <= 114, f"Surah out of range: {s}"
            assert v >= 1, f"Verse < 1: {a['reference']}"

    def test_fatihah_has_7_ayahs(self):
        surah1 = [a for a in self.ayahs if a["surah"] == 1]
        assert len(surah1) == 7, f"Surah 1 has {len(surah1)} ayahs"

    def test_baqarah_first_ayah(self):
        a = next((x for x in self.ayahs if x["reference"] == "2:1"), None)
        assert a is not None, "2:1 not found"
        assert a["text"].strip(), "2:1 text is empty"


@pytest.mark.skipif(not DB_PATH.exists(), reason="quran.db not yet generated")
class TestDatabase:
    def setup_method(self):
        self.conn = sqlite3.connect(str(DB_PATH))
        self.conn.row_factory = sqlite3.Row

    def teardown_method(self):
        self.conn.close()

    def test_surah_count(self):
        count = self.conn.execute("SELECT COUNT(*) FROM quran_surah").fetchone()[0]
        assert count == 114, f"Expected 114 surahs, got {count}"

    def test_minimum_ayah_count_in_db(self):
        count = self.conn.execute("SELECT COUNT(*) FROM quran_ayah").fetchone()[0]
        assert count >= 6000, f"Only {count} ayahs in DB"

    def test_fatihah_row(self):
        row = self.conn.execute(
            "SELECT * FROM quran_ayah WHERE surah=1 AND ayah=1"
        ).fetchone()
        assert row is not None, "Surah 1, Ayah 1 not in DB"
        assert row["text"].strip(), "Surah 1 Ayah 1 text empty"

    def test_fts_search(self):
        rows = self.conn.execute(
            "SELECT * FROM quran_fts WHERE quran_fts MATCH 'mercy' LIMIT 5"
        ).fetchall()
        assert len(rows) > 0, "FTS5 returned no results for 'mercy'"

    def test_reference_uniqueness(self):
        dup = self.conn.execute(
            "SELECT reference, COUNT(*) c FROM quran_ayah GROUP BY reference HAVING c > 1"
        ).fetchall()
        assert len(dup) == 0, f"Duplicate references in DB: {[r['reference'] for r in dup]}"

    def test_invalid_reference_returns_nothing(self):
        row = self.conn.execute(
            "SELECT * FROM quran_ayah WHERE surah=1 AND ayah=999"
        ).fetchone()
        assert row is None
