"""
Configuration for the Bayyinah app scraper.

If the app updates its UI, change selectors here — not in scraper.py.

To find the correct package name and resource IDs for your device:
    python run.py --discover
"""

# ─── App identity ────────────────────────────────────────────────────────────
# Find yours: adb shell pm list packages | grep -i bayyinah
APP_PACKAGE = "tv.bayyinah.quran"

# ─── Bottom nav ──────────────────────────────────────────────────────────────
# Text on the Surahs tab (matches the screenshot: "Surahs")
SURAHS_TAB_TEXT = "Surahs"

# ─── Surah list page ─────────────────────────────────────────────────────────
SURAH_SEARCH_HINT = "Search surahs..."

# ─── Quran reader page (mushaf view) ─────────────────────────────────────────
# Resource ID of the ayah verse-number markers (circles with numbers).
# Leave empty to auto-discover via dump_hierarchy (--discover mode).
# Example: "tv.bayyinah.quran:id/verse_number"
VERSE_MARKER_RESOURCE_ID = ""

# Fallback: content-description prefix used on verse markers
# e.g. "Verse 5" or "آية ٥"
VERSE_MARKER_CONTENT_DESC_PREFIX = ""

# ─── Popup / bottom sheet ────────────────────────────────────────────────────
POPUP_CONCISE_TAB_TEXT = "Concise"
POPUP_CLOSE_BUTTON_DESC = "Close"       # content-description on the ✕ button
POPUP_CLOSE_BUTTON_TEXT = ""            # fallback if no desc

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
