#!/usr/bin/env python3
"""
Rewrite ayah descriptions to avoid copyright while preserving context/meaning.

Creates data/quran-with-tafsir-data.db as a copy of data/quran-with-tafsir.db
and rewrites each description through an LLM (OpenAI-compatible API).

Usage:
    export OPENAI_API_KEY='sk-...'
    python rewrite.py                           # full run
    python rewrite.py --resume                  # resume from last checkpoint
    python rewrite.py --dry-run                 # show what would be rewritten
    python rewrite.py --check                   # count remaining descriptions
    python rewrite.py --reset                   # clear progress and start over

Configuration via environment variables:
    OPENAI_API_KEY      — API key (required)
    OPENAI_BASE_URL     — API base URL (default: https://api.openai.com/v1)
    REWRITE_MODEL       — Model name (default: gpt-4o-mini)
    REWRITE_BATCH_SIZE  — Descriptions per API call (default: 3)
"""

from __future__ import annotations

import json
import os
import pathlib
import re as _re
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timezone

# ─── Paths ────────────────────────────────────────────────────────────────────

REPO_ROOT = pathlib.Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data"
SOURCE_DB = DATA_DIR / "quran-with-tafsir.db"
OUTPUT_DB = DATA_DIR / "quran-with-tafsir-data.db"
PROGRESS_FILE = pathlib.Path(__file__).parent / "rewrite_progress.json"

# ─── Config from env ──────────────────────────────────────────────────────────

API_KEY = os.environ.get("OPENAI_API_KEY", "")
BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
MODEL = os.environ.get("REWRITE_MODEL", "gpt-4o-mini")
BATCH_SIZE = int(os.environ.get("REWRITE_BATCH_SIZE", "3"))
MAX_RETRIES = 3


# ─── DB helpers ───────────────────────────────────────────────────────────────

def init_output_db() -> sqlite3.Connection:
    """Create quran-with-tafsir-data.db from the source if needed."""
    if not SOURCE_DB.exists():
        print(f"[rewrite] ERROR: Source DB not found: {SOURCE_DB}")
        sys.exit(1)

    conn = sqlite3.connect(str(OUTPUT_DB))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    cols = [r["name"] for r in conn.execute("PRAGMA table_info(ayah_descriptions)").fetchall()]

    if "description_reworded" not in cols:
        conn.close()
        if OUTPUT_DB.exists():
            OUTPUT_DB.unlink()
        print(f"[rewrite] Copying {SOURCE_DB.name} → {OUTPUT_DB.name}")
        shutil.copy2(str(SOURCE_DB), str(OUTPUT_DB))
        conn = sqlite3.connect(str(OUTPUT_DB))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        print("[rewrite] Adding description_reworded column")
        conn.execute("ALTER TABLE ayah_descriptions ADD COLUMN description_reworded TEXT")
        conn.execute("ALTER TABLE ayah_descriptions ADD COLUMN reworded_at TEXT")
        conn.commit()
    else:
        print(f"[rewrite] Output DB exists with {count_done(conn)} already rewritten")

    return conn


def get_todo(conn: sqlite3.Connection) -> list[dict]:
    """Return all ayahs that still need rewriting."""
    rows = conn.execute("""
        SELECT surah, ayah, description, description_range
        FROM ayah_descriptions
        WHERE description_reworded IS NULL OR description_reworded = ''
        ORDER BY surah, ayah
    """).fetchall()
    return [dict(r) for r in rows]


def count_done(conn: sqlite3.Connection) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM ayah_descriptions "
        "WHERE description_reworded IS NOT NULL AND description_reworded != ''"
    ).fetchone()[0]


def count_total(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM ayah_descriptions").fetchone()[0]


def save_rewritten(conn: sqlite3.Connection, surah: int, ayah: int, text: str) -> None:
    conn.execute(
        "UPDATE ayah_descriptions SET description_reworded = ?, reworded_at = ? "
        "WHERE surah = ? AND ayah = ?",
        (text, datetime.now(timezone.utc).isoformat(), surah, ayah),
    )
    conn.commit()


# ─── Progress tracking ────────────────────────────────────────────────────────

def load_progress() -> tuple[int, int]:
    if not PROGRESS_FILE.exists():
        return 0, 0
    try:
        d = json.loads(PROGRESS_FILE.read_text())
        return int(d["surah"]), int(d["ayah"])
    except (KeyError, ValueError, json.JSONDecodeError):
        return 0, 0


def save_progress(surah: int, ayah: int) -> None:
    PROGRESS_FILE.write_text(json.dumps({"surah": surah, "ayah": ayah}))


def reset_progress() -> None:
    if PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()
        print("[rewrite] Progress reset")


# ─── LLM API ──────────────────────────────────────────────────────────────────

def _call_llm(messages: list[dict], max_tokens: int = 4096) -> str:
    """Make an OpenAI-compatible chat completion call. Returns content string."""
    import urllib.request
    import urllib.error

    payload = {
        "model": MODEL,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": max_tokens,
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=data,
        headers=headers,
        method="POST",
    )

    last_error = ""
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            return result["choices"][0]["message"]["content"].strip()

        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            last_error = f"HTTP {e.code}: {body[:200]}"
            if e.code == 429:
                wait = 2 ** attempt * 10
                print(f"  ⏳ Rate limited — waiting {wait}s…")
                time.sleep(wait)
                continue
            elif e.code >= 500:
                wait = 2 ** attempt * 5
                print(f"  ⏳ Server error ({e.code}) — retrying in {wait}s…")
                time.sleep(wait)
                continue
            else:
                return ""

        except (urllib.error.URLError, OSError, json.JSONDecodeError, Exception) as e:
            last_error = str(e)
            wait = 2 ** attempt * 5
            print(f"  ⏳ Network error — retrying in {wait}s… ({e})")
            time.sleep(wait)
            continue

    print(f"  ❌ Failed after {MAX_RETRIES} retries: {last_error}")
    return ""


SYSTEM_PROMPT = (
    "You are a skilled rewriter. Paraphrase the following Islamic tafsir "
    "(commentary) content so it conveys the **same meaning and context** but "
    "uses **completely different wording, sentence structure, and phrasing**. "
    "This avoids copyright while preserving the original content's value.\n\n"
    "Rules:\n"
    "1. Keep the exact Arabic Quranic text unchanged — do not modify it.\n"
    "2. Keep the 'Ayah N' heading exactly as-is.\n"
    "3. Rewrite ALL English commentary in your own fresh words.\n"
    "4. Preserve all key concepts, examples, analogies, and insights.\n"
    "5. Do NOT add any new content, opinions, or interpretations.\n"
    "6. Do NOT use meta-commentary like 'In this passage...' or 'The text discusses...'\n"
    "7. Maintain the same section headings but rephrase them.\n"
    "8. Output each rewritten description separated by the delimiter: <<<SEP>>>"
)


def rewrite_batch(descriptions: list[dict]) -> list[str]:
    """
    Send a batch of descriptions to the LLM and return rewritten texts.
    Returns list in the same order as input, or empty strings on failure.
    """
    batch_text = ""
    for i, d in enumerate(descriptions):
        batch_text += (
            f"--- DESCRIPTION {i+1} (Surah {d['surah']}:{d['ayah']}) ---\n"
            f"{d['description']}\n\n"
        )

    user_prompt = (
        f"Rewrite the following {len(descriptions)} tafsir descriptions. "
        f"Preserve the meaning and all key insights, but use completely different wording.\n\n"
        f"{batch_text}\n"
        f"Output each rewritten description separated by '<<<SEP>>>' on its own line. "
        f"Start each rewritten description with the original 'Ayah N' heading."
    )

    content = _call_llm([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ])

    if not content:
        return [""] * len(descriptions)

    parts = [p.strip() for p in content.split("<<<SEP>>>") if p.strip()]

    # Clean each part: the LLM often echoes back the "--- DESCRIPTION N (Surah X:Y) ---"
    # label even though we asked for <<<SEP>>> separators.
    def _clean(part: str) -> str:
        return _re.sub(r'^---\s*DESCRIPTION\s*\d+\s*\([^)]+\)\s*---\s*', '', part, flags=_re.IGNORECASE).strip()

    parts = [_clean(p) for p in parts]

    while len(parts) < len(descriptions):
        parts.append("")
    return parts[:len(descriptions)]


def rewrite_single(desc: dict) -> str:
    """Rewrite a single description (used for very long ones)."""
    user_prompt = f"Rewrite this tafsir description in your own words:\n\n{desc['description']}"
    return _call_llm([
        {"role": "system", "content": SYSTEM_PROMPT.replace("Output each rewritten description separated by the delimiter: <<<SEP>>>", "")},
        {"role": "user", "content": user_prompt},
    ], max_tokens=8192)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    import argparse
    from itertools import groupby

    parser = argparse.ArgumentParser(
        description="Rewrite ayah descriptions to avoid copyright while preserving meaning."
    )
    parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    parser.add_argument("--reset", action="store_true", help="Delete progress and start over")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be rewritten without calling API")
    parser.add_argument("--check", action="store_true", help="Count remaining and exit")
    args = parser.parse_args()

    if args.reset:
        reset_progress()

    conn = init_output_db()
    total = count_total(conn)

    if args.check:
        done = count_done(conn)
        print(f"[rewrite] {done} / {total} ayahs rewritten ({total - done} remaining)")
        conn.close()
        return

    # ── Determine resume skip point ──
    skip_until: tuple[int, int] | None = None
    if args.resume:
        rs, ra = load_progress()
        if rs:
            skip_until = (rs, ra)
            print(f"[rewrite] Resuming after Surah {rs}:{ra}")

    todo = get_todo(conn)
    if skip_until:
        todo = [t for t in todo
                if (t["surah"] > skip_until[0])
                or (t["surah"] == skip_until[0] and t["ayah"] > skip_until[1])]

    remaining = len(todo)
    done = total - remaining

    if args.dry_run:
        print(f"[rewrite] DRY RUN — Would rewrite {remaining} ayahs")
        for t in todo[:5]:
            print(f"  Surah {t['surah']}:{t['ayah']} ({len(t['description'])} chars)")
        if remaining > 5:
            print(f"  ... and {remaining - 5} more")
        conn.close()
        return

    if not API_KEY:
        print("[rewrite] ERROR: OPENAI_API_KEY environment variable not set.")
        print("  export OPENAI_API_KEY='sk-...'")
        print("  Optional: set OPENAI_BASE_URL for compatible APIs (Groq, Together, local, etc.)")
        conn.close()
        sys.exit(1)

    print(f"[rewrite] Model: {MODEL}")
    print(f"[rewrite] Base:  {BASE_URL}")
    print(f"[rewrite] Batch: {BATCH_SIZE}")
    print(f"[rewrite] Output: {OUTPUT_DB}")

    print(f"[rewrite] {done} / {total} done — {remaining} to rewrite")

    if remaining == 0:
        print("[rewrite] ✅ All done!")
        conn.close()
        return

    # ── Process by surah ──
    for surah, group in groupby(todo, key=lambda t: t["surah"]):
        surah_ayahs = list(group)
        print(f"\n[rewrite] ── Surah {surah} ({len(surah_ayahs)} ayahs) ──")

        i = 0
        while i < len(surah_ayahs):
            batch = surah_ayahs[i:i + BATCH_SIZE]

            # Very long descriptions (>12KB) need individual processing
            any_long = any(len(d["description"]) > 12000 for d in batch)

            if any_long:
                for d in batch:
                    size_kb = len(d["description"]) / 1024
                    print(f"  [{d['surah']}:{d['ayah']}] ({size_kb:.0f}KB)…", end=" ", flush=True)
                    rewritten = rewrite_single(d)
                    if rewritten:
                        save_rewritten(conn, d["surah"], d["ayah"], rewritten)
                        print(f"✓ {len(rewritten)} chars")
                    else:
                        print("❌ failed")
                    save_progress(d["surah"], d["ayah"])
                    time.sleep(0.5)
                i += len(batch)
            else:
                ayah_nums = [str(d["ayah"]) for d in batch]
                print(f"  [{surah}:{','.join(ayah_nums)}]…", end=" ", flush=True)
                results = rewrite_batch(batch)

                ok_count = 0
                for d, r in zip(batch, results):
                    if r:
                        save_rewritten(conn, d["surah"], d["ayah"], r)
                        ok_count += 1

                if ok_count == len(batch):
                    print(f"✓ batch ({ok_count} ayahs)")
                else:
                    print(f"⚠ {ok_count}/{len(batch)} succeeded")

                last_in = batch[-1]
                save_progress(last_in["surah"], last_in["ayah"])
                time.sleep(1.0)
                i += len(batch)

        # Surah summary
        surah_done = conn.execute(
            "SELECT COUNT(*) FROM ayah_descriptions "
            "WHERE surah=? AND description_reworded IS NOT NULL AND description_reworded != ''",
            (surah,),
        ).fetchone()[0]
        print(f"  ✓ Surah {surah}: {surah_done}/{len(surah_ayahs)} done")

    final_done = count_done(conn)
    print(f"\n[rewrite] ✅ Complete! {final_done} / {total} ayahs rewritten")
    print(f"           Output: {OUTPUT_DB}")
    conn.close()


if __name__ == "__main__":
    main()
