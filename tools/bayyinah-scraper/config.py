"""
Configuration for the Bayyinah app scraper.

If the app updates its UI, change selectors here — not in scraper.py.

To find the correct package name and resource IDs for your device:
    python run.py --discover
"""

# ─── App identity ────────────────────────────────────────────────────────────
APP_PACKAGE = "com.ayahbyayah.android"

# ─── Bottom nav ──────────────────────────────────────────────────────────────
SURAHS_TAB_TEXT = "Surahs"

# ─── Quran reader page (mushaf view) ─────────────────────────────────────────
# Verse markers are Arabic-Indic numerals (١٢٣...) embedded in the Quran text.
# Auto-detection (Strategy 3) finds them as small TextViews with numeral content.
VERSE_MARKER_RESOURCE_ID = ""
VERSE_MARKER_CONTENT_DESC_PREFIX = ""

# ─── Popup / bottom sheet ────────────────────────────────────────────────────
POPUP_CONCISE_TAB_TEXT = "Concise"
# No close button in the app — the popup is dismissed by pressing Back.
POPUP_CLOSE_BUTTON_DESC = ""
POPUP_CLOSE_BUTTON_TEXT = ""

# ─── Timing (seconds) ────────────────────────────────────────────────────────
POPUP_APPEAR_TIMEOUT = 6        # max wait for popup after long-press
ELEMENT_TIMEOUT = 5             # generic element-find timeout
SCROLL_PAUSE = 0.4              # pause after each popup scroll
AYAH_PAUSE = 0.8                # pause between processing ayahs
PAGE_SWIPE_PAUSE = 1.5          # pause after swiping to next Quran page
BACK_PAUSE = 1.0                # pause after pressing back

# ─── Paths ───────────────────────────────────────────────────────────────────
import os, pathlib

REPO_ROOT = pathlib.Path(__file__).parent.parent.parent
SOURCE_DB = REPO_ROOT / "data" / "quran.db"
OUTPUT_DB = REPO_ROOT / "data" / "quran-with-tafsir.db"
PROGRESS_FILE = pathlib.Path(__file__).parent / "progress.json"
REFETCH_PROGRESS_FILE = pathlib.Path(__file__).parent / "refetch_progress.json"
REFETCH_LIST_FILE = pathlib.Path(__file__).parent / "refetch_list.json"
