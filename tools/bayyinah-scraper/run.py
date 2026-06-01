"""
CLI entry point for the Bayyinah scraper.

Usage examples:
    python run.py                       # start fresh OR resume (auto-detects)
    python run.py --resume              # force resume from progress.json
    python run.py --reset               # delete progress and start from 1:1
    python run.py --surah 2 --ayah 1    # start at a specific verse
    python run.py --discover            # dump UI hierarchy to XML (for setup)
    python run.py --status              # show how many ayahs are scraped
    python run.py --device SERIAL       # specify ADB device serial
"""

import argparse
import sys

import config as cfg
import db
import progress as prog


def main():
    parser = argparse.ArgumentParser(
        description="Bayyinah app scraper — extracts Concise tafseer for all 6,236 ayahs"
    )
    parser.add_argument("--resume",   action="store_true", help="Resume from progress.json")
    parser.add_argument("--reset",    action="store_true", help="Delete progress and start from Surah 1:1")
    parser.add_argument("--surah",    type=int, default=None, help="Start at this surah (1–114)")
    parser.add_argument("--ayah",     type=int, default=None, help="Start at this ayah (requires --surah)")
    parser.add_argument("--discover", action="store_true", help="Dump UI hierarchy and screenshot to XML/PNG")
    parser.add_argument("--status",   action="store_true", help="Show DB progress and exit")
    parser.add_argument("--device",   type=str, default=None, help="ADB device serial (optional)")
    args = parser.parse_args()

    # ── status ────────────────────────────────────────────────────────────────
    if args.status:
        conn = db.init_db()
        scraped = db.scraped_count(conn)
        conn.close()
        last_surah, last_ayah = prog.load()
        print(f"Scraped : {scraped} / 6236 ayahs")
        if last_surah:
            print(f"Last    : Surah {last_surah}:{last_ayah}")
        else:
            print("Progress: not started")
        sys.exit(0)

    # ── reset ─────────────────────────────────────────────────────────────────
    if args.reset:
        prog.reset()
        sys.exit(0)

    # ── determine start point ─────────────────────────────────────────────────
    if args.surah:
        start_surah = args.surah
        start_ayah  = args.ayah or 1
    else:
        last_surah, last_ayah = prog.load()
        if last_surah == 0:
            # No progress — start from the beginning
            start_surah, start_ayah = 1, 1
        else:
            # Resume from the ayah AFTER the last completed one
            conn = db.init_db()
            ayah_count = db.get_surah_ayah_count(conn, last_surah)
            conn.close()
            if last_ayah >= ayah_count:
                start_surah = last_surah + 1
                start_ayah  = 1
            else:
                start_surah = last_surah
                start_ayah  = last_ayah + 1
        if args.resume:
            print(f"[run] Resuming from Surah {start_surah}:{start_ayah}")

    # ── validate ──────────────────────────────────────────────────────────────
    if not (1 <= start_surah <= 114):
        parser.error("--surah must be between 1 and 114")
    if not (1 <= start_ayah):
        parser.error("--ayah must be ≥ 1")

    # ── run ───────────────────────────────────────────────────────────────────
    from scraper import BayyinahScraper

    scraper = BayyinahScraper(device_serial=args.device)

    if args.discover:
        print("[run] Discover mode — navigate to the Quran reader page, then press Enter…")
        input()
        scraper.dump_hierarchy("ui_hierarchy.xml")
        sys.exit(0)

    scraper.run(start_surah=start_surah, start_ayah=start_ayah)


if __name__ == "__main__":
    main()
