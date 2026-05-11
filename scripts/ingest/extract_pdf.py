"""
extract_pdf.py — Extract all ayahs from The Clear Quran PDF.

Output: data/ayahs.json
Schema: [{surah, ayah, reference, text, display_text, tokens_count}]

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

# Known ayah counts for all 114 surahs (authoritative reference)
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

assert len(AYAH_COUNTS) == 114, "AYAH_COUNTS must have exactly 114 entries"

# Patterns used to detect ayah boundaries
# Many translations mark ayahs as (n) or with |number|
AYAH_NUMBER_PATTERN = re.compile(r'\((\d{1,3})\)')
SURAH_HEADER_PATTERN = re.compile(
    r'(?:Chapter|Surah|S[Uu][Rr][Aa][Hh])\s*[:\-–—]?\s*(\d{1,3})', re.IGNORECASE
)
BISMILLAH_PATTERN = re.compile(
    r'In the name of (Allah|God),?\s+the Entirely Merciful,?\s+the Especially Merciful',
    re.IGNORECASE,
)


def extract_pages(pdf_path: Path) -> list[str]:
    try:
        import pdfplumber
    except ImportError:
        sys.exit("ERROR: pdfplumber is not installed. Run: pip3 install pdfplumber>=0.11.0")

    pages: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            pages.append(text)
    return pages


def clean_line(line: str) -> str:
    return re.sub(r'\s+', ' ', line).strip()


def parse_ayahs(pages: list[str]) -> list[dict]:
    """
    Heuristic parser for The Clear Quran layout.

    The Clear Quran uses a consistent format: ayah number appears in parentheses
    at the end of the ayah, e.g.: "All praise is for Allah..." (1)
    Surah boundaries are detected by chapter headers.
    """
    full_text = "\n".join(pages)

    # We'll do a two-pass approach:
    # Pass 1: find surah/chapter boundaries
    # Pass 2: within each surah block, extract numbered ayahs

    # Split into lines for processing
    lines = [clean_line(l) for l in full_text.splitlines() if clean_line(l)]

    ayahs: list[dict] = []
    current_surah = 0
    buffer_lines: list[str] = []
    surah_buffers: list[tuple[int, list[str]]] = []  # (surah_num, lines)

    for line in lines:
        surah_match = SURAH_HEADER_PATTERN.search(line)
        if surah_match:
            new_surah = int(surah_match.group(1))
            if 1 <= new_surah <= 114 and new_surah != current_surah:
                if current_surah > 0 and buffer_lines:
                    surah_buffers.append((current_surah, list(buffer_lines)))
                current_surah = new_surah
                buffer_lines = []
                continue
        if current_surah > 0:
            buffer_lines.append(line)

    if current_surah > 0 and buffer_lines:
        surah_buffers.append((current_surah, list(buffer_lines)))

    # If we detected < 50 surahs, fall back to sequential number-based parsing
    if len(surah_buffers) < 50:
        print(
            f"WARNING: Only detected {len(surah_buffers)} surah headers. "
            "Falling back to flat sequential parsing."
        )
        ayahs = _flat_parse(full_text)
    else:
        for surah_num, slines in surah_buffers:
            surah_ayahs = _parse_surah_lines(surah_num, slines)
            ayahs.extend(surah_ayahs)

    return ayahs


def _parse_surah_lines(surah: int, lines: list[str]) -> list[dict]:
    """Extract ayahs from lines belonging to a single surah."""
    expected = AYAH_COUNTS[surah - 1]
    result: list[dict] = []

    # Join lines into continuous text
    text_blob = " ".join(lines)

    # Find all (N) markers
    # An ayah ends at its (N) marker
    segments = re.split(r'\((\d{1,3})\)', text_blob)
    # segments: [pre_1, num_1, pre_2, num_2, ...]

    current_text_parts: list[str] = []

    for i, seg in enumerate(segments):
        if i % 2 == 0:
            # Text part
            current_text_parts.append(seg.strip())
        else:
            # Ayah number
            ayah_num = int(seg)
            raw = " ".join(current_text_parts).strip()
            raw = re.sub(r'\s+', ' ', raw)
            # Strip Bismillah from ayah 1 if it accidentally absorbs it
            raw = BISMILLAH_PATTERN.sub('', raw).strip()
            if raw and 1 <= ayah_num <= expected:
                result.append(_make_ayah(surah, ayah_num, raw))
            current_text_parts = []

    # Deduplicate by ayah number, keeping last occurrence
    seen: dict[int, dict] = {}
    for a in result:
        seen[a['ayah']] = a
    return [seen[k] for k in sorted(seen.keys())]


def _flat_parse(full_text: str) -> list[dict]:
    """
    Last-resort parser: assume the PDF is a continuous stream.
    We detect surah transitions by counting: when ayah (N) appears and
    the previous surah's count is satisfied, we advance the surah counter.
    """
    segments = re.split(r'\((\d{1,3})\)', full_text)
    ayahs: list[dict] = []
    current_surah = 1
    expected_next = 1
    current_text_parts: list[str] = []

    for i, seg in enumerate(segments):
        if i % 2 == 0:
            current_text_parts.append(seg.strip())
        else:
            ayah_num = int(seg)
            raw = " ".join(current_text_parts).strip()
            raw = re.sub(r'\s+', ' ', raw)
            raw = BISMILLAH_PATTERN.sub('', raw).strip()
            current_text_parts = []

            if ayah_num == 1 and expected_next > 1:
                # Likely a new surah
                current_surah += 1
                if current_surah > 114:
                    break
                expected_next = 1

            expected = AYAH_COUNTS[current_surah - 1]
            if raw and ayah_num == expected_next and ayah_num <= expected:
                ayahs.append(_make_ayah(current_surah, ayah_num, raw))
                expected_next = ayah_num + 1
                if expected_next > expected:
                    current_surah += 1
                    if current_surah > 114:
                        break
                    expected_next = 1

    return ayahs


def _make_ayah(surah: int, ayah: int, text: str) -> dict:
    reference = f"{surah}:{ayah}"
    return {
        "surah": surah,
        "ayah": ayah,
        "reference": reference,
        "text": text,
        "display_text": text,
        "tokens_count": len(text.split()),
    }


def main():
    if not PDF_PATH.exists():
        sys.exit(f"ERROR: PDF not found at {PDF_PATH}")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    print(f"Extracting text from {PDF_PATH.name} …")
    pages = extract_pages(PDF_PATH)
    print(f"  Read {len(pages)} pages.")

    print("Parsing ayahs …")
    ayahs = parse_ayahs(pages)
    print(f"  Parsed {len(ayahs)} ayahs.")

    if len(ayahs) == 0:
        sys.exit("ERROR: No ayahs extracted. Check PDF format.")

    OUTPUT_PATH.write_text(json.dumps(ayahs, ensure_ascii=False, indent=2))
    print(f"  Saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
