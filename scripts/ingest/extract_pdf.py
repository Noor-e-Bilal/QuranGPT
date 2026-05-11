"""
extract_pdf.py — Extract all ayahs from The Clear Quran PDF.

Output: data/ayahs.json
Schema: [{surah, ayah, reference, text, display_text, tokens_count}]

The Clear Quran layout:
  - Surah header:  "N. Title\n(Arabic Name)\n<intro paragraph>"
  - Ayahs:         inline numbered "1. text 2. text 3. text…"
  - Footnotes:     [N] markers — stripped
  - Bismillah:     standalone line before ayahs (except surah 9)
  - Section heads: thematic headings between ayahs — left in text, harmless

Run from repo root:
    python3 scripts/ingest/extract_pdf.py
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PDF_PATH = ROOT / "Docs" / "the-clear-quran-a-thematic-english-translation.pdf"
OUTPUT_PATH = ROOT / "data" / "ayahs.json"

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

assert len(AYAH_COUNTS) == 114, "AYAH_COUNTS must have exactly 114 entries"

# Matches "N. Title\n(Arabic Name)" — title may start with decorative bracket ˹
SURAH_HEADER_RE = re.compile(
    r'(?:^|\n)(\d{1,3})\.\s+[^\n]+\n\s*\([^\)]+\)',
    re.MULTILINE,
)

FOOTNOTE_RE = re.compile(r'\[\d+\]')
WHITESPACE_RE = re.compile(r'\s+')


def extract_pages(pdf_path: Path) -> list[str]:
    try:
        import pdfplumber
    except ImportError:
        sys.exit("ERROR: pdfplumber is not installed. Run: pip3 install pdfplumber>=0.11.0")

    pages: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or "")
    return pages


def clean_text(text: str) -> str:
    text = FOOTNOTE_RE.sub("", text)
    return WHITESPACE_RE.sub(" ", text).strip()


def extract_ayahs_from_surah(text: str, surah_num: int, expected: int) -> list[dict]:
    """
    Extract ayahs from the text block of one surah using sequential inline numbering.
    The Clear Quran places ayah numbers inline: "1. text 2. text 3. text…"
    """
    text = clean_text(text)
    ayahs: list[dict] = []
    pos = 0

    for n in range(1, expected + 1):
        # (?<!\d) ensures we don't match "14. " when looking for "4. "
        match = re.search(r"(?<!\d)" + str(n) + r"\. ", text[pos:])
        if not match:
            print(f"  WARNING: {surah_num}:{n} not found (searched from pos {pos})", file=sys.stderr)
            break

        ayah_start = pos + match.end()

        if n < expected:
            end_match = re.search(r"(?<!\d)" + str(n + 1) + r"\. ", text[ayah_start:])
            ayah_end = ayah_start + end_match.start() if end_match else len(text)
        else:
            ayah_end = len(text)

        ayah_text = WHITESPACE_RE.sub(" ", text[ayah_start:ayah_end]).strip()
        if ayah_text:
            ref = f"{surah_num}:{n}"
            ayahs.append({
                "surah": surah_num,
                "ayah": n,
                "reference": ref,
                "text": ayah_text,
                "display_text": ayah_text,
                "tokens_count": len(ayah_text.split()),
            })

        pos = ayah_start

    return ayahs


def parse_all(pages: list[str]) -> list[dict]:
    full_text = "\n".join(pages)

    # Collect unique surah headers (first occurrence of each surah number wins)
    seen: set[int] = set()
    boundaries: list[tuple[int, int, int]] = []  # (surah_num, match_start, match_end)
    for m in SURAH_HEADER_RE.finditer(full_text):
        sn = int(m.group(1))
        if 1 <= sn <= 114 and sn not in seen:
            seen.add(sn)
            boundaries.append((sn, m.start(), m.end()))

    boundaries.sort(key=lambda x: x[1])  # sort by position in text
    print(f"  Found {len(boundaries)} surah headers", file=sys.stderr)

    if len(boundaries) < 100:
        sys.exit(f"ERROR: Only {len(boundaries)} surah headers detected — aborting.")

    all_ayahs: list[dict] = []
    for i, (sn, _start, end) in enumerate(boundaries):
        next_start = boundaries[i + 1][1] if i + 1 < len(boundaries) else len(full_text)
        surah_text = full_text[end:next_start]
        expected = AYAH_COUNTS[sn - 1]
        ayahs = extract_ayahs_from_surah(surah_text, sn, expected)
        if len(ayahs) < expected:
            print(
                f"  WARNING: Surah {sn}: extracted {len(ayahs)}/{expected} ayahs",
                file=sys.stderr,
            )
        all_ayahs.extend(ayahs)

    return all_ayahs


def main() -> None:
    if not PDF_PATH.exists():
        sys.exit(f"ERROR: PDF not found at {PDF_PATH}")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    print(f"Extracting text from {PDF_PATH.name} …")
    pages = extract_pages(PDF_PATH)
    print(f"  Read {len(pages)} pages.")

    print("Parsing ayahs …")
    ayahs = parse_all(pages)
    print(f"  Parsed {len(ayahs)} ayahs.")

    if len(ayahs) == 0:
        sys.exit("ERROR: No ayahs extracted.")

    OUTPUT_PATH.write_text(json.dumps(ayahs, ensure_ascii=False, indent=2))
    print(f"  Saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
