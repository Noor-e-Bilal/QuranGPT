"""
validate.py — Validate data/ayahs.json against known ayah counts.

Run from repo root:
    python3 scripts/ingest/validate.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AYAHS_PATH = ROOT / "data" / "ayahs.json"

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
TOTAL_EXPECTED = sum(AYAH_COUNTS)  # 6236


def validate() -> bool:
    if not AYAHS_PATH.exists():
        print(f"ERROR: {AYAHS_PATH} not found. Run extract_pdf.py first.")
        return False

    with open(AYAHS_PATH) as f:
        ayahs: list[dict] = json.load(f)

    total = len(ayahs)
    print(f"Total ayahs loaded: {total} (expected {TOTAL_EXPECTED})")

    # Group by surah
    by_surah: dict[int, list[dict]] = {}
    for a in ayahs:
        s = int(a["surah"])
        by_surah.setdefault(s, []).append(a)

    errors: list[str] = []
    warnings: list[str] = []

    # Check all 114 surahs
    for surah_num in range(1, 115):
        expected = AYAH_COUNTS[surah_num - 1]
        found = len(by_surah.get(surah_num, []))

        if found == 0:
            errors.append(f"Surah {surah_num}: MISSING (expected {expected} ayahs)")
        elif found != expected:
            warnings.append(
                f"Surah {surah_num}: got {found} ayahs, expected {expected} "
                f"(diff={found - expected:+d})"
            )

    # Check for duplicate references
    refs = [a["reference"] for a in ayahs]
    dup_refs = [r for r in set(refs) if refs.count(r) > 1]
    for ref in dup_refs:
        errors.append(f"Duplicate reference: {ref}")

    # Check for empty texts
    empty = [a["reference"] for a in ayahs if not a.get("text", "").strip()]
    for ref in empty:
        warnings.append(f"Empty text for reference: {ref}")

    # Report
    if errors:
        print(f"\n[ERRORS] {len(errors)} issues:")
        for e in errors:
            print(f"  ✗ {e}")
    if warnings:
        print(f"\n[WARNINGS] {len(warnings)} issues:")
        for w in warnings:
            print(f"  ⚠ {w}")

    if not errors and not warnings:
        print("\n✓ All surahs validated successfully.")
        return True
    elif not errors:
        print(f"\n✓ Validation passed with {len(warnings)} warnings (no blocking errors).")
        return True
    else:
        print(f"\n✗ Validation FAILED with {len(errors)} blocking errors.")
        return False


if __name__ == "__main__":
    ok = validate()
    sys.exit(0 if ok else 1)
