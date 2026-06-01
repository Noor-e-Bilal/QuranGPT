"""
Progress tracking — saves after every ayah so the scraper can resume
from exactly where it left off after a crash, ADB disconnect, or app freeze.

File: tools/bayyinah-scraper/progress.json
Format: {"surah": 2, "ayah": 15}
"""

import json
import config as cfg


def load() -> tuple[int, int]:
    """Return (surah, ayah) of the LAST SUCCESSFULLY SCRAPED ayah.
    Returns (0, 0) if no progress file exists (start from beginning).
    """
    if not cfg.PROGRESS_FILE.exists():
        return 0, 0
    try:
        data = json.loads(cfg.PROGRESS_FILE.read_text())
        return int(data["surah"]), int(data["ayah"])
    except (KeyError, ValueError, json.JSONDecodeError):
        return 0, 0


def save(surah: int, ayah: int) -> None:
    """Record that surah:ayah has been successfully stored in the DB."""
    cfg.PROGRESS_FILE.write_text(json.dumps({"surah": surah, "ayah": ayah}))


def reset() -> None:
    """Delete progress file to restart from Surah 1:1."""
    if cfg.PROGRESS_FILE.exists():
        cfg.PROGRESS_FILE.unlink()
        print("[progress] Reset — will start from Surah 1, Ayah 1")
