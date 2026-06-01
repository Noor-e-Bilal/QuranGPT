from __future__ import annotations
"""
Text extraction and parsing for the Bayyinah popup.

After the bottom sheet opens, this module:
1. Scrolls through the popup to collect all visible text blocks
2. Detects whether the popup covers a single ayah or a grouped range
3. Returns structured data ready for DB storage
"""

import re
import time
from dataclasses import dataclass

import config as cfg


@dataclass
class PopupContent:
    raw_text: str               # full description text
    range_str: str | None       # "1-3" if grouped, None if single
    start_ayah: int             # first ayah covered
    end_ayah: int               # last ayah covered (== start_ayah if single)


# ─── Range detection ─────────────────────────────────────────────────────────

_GROUPED_PATTERN = re.compile(
    r"Ayahs?\s+(\d+)\s*[-–—]\s*(\d+)",
    re.IGNORECASE,
)
_SINGLE_PATTERN = re.compile(r"Ayah\s+(\d+)", re.IGNORECASE)


def _parse_range(text: str) -> tuple[int | None, int | None, str | None]:
    """
    Scan text for "Ayahs X-Y" or "Ayah X" headings.
    Returns (start, end, range_str) or (None, None, None).
    """
    m = _GROUPED_PATTERN.search(text)
    if m:
        s, e = int(m.group(1)), int(m.group(2))
        return s, e, f"{s}-{e}"

    m = _SINGLE_PATTERN.search(text)
    if m:
        n = int(m.group(1))
        return n, n, None

    return None, None, None


# ─── Popup scrolling + text collection ───────────────────────────────────────

def extract(d, expected_ayah: int) -> PopupContent | None:
    """
    Collect all text from the open Concise popup.

    Scrolls the popup until no new text appears, then parses for
    ayah range metadata.

    Args:
        d: uiautomator2 device handle
        expected_ayah: the ayah we long-pressed (used as fallback if
                       the popup title can't be parsed)

    Returns:
        PopupContent or None if the popup looks wrong / closed
    """
    # Confirm Concise tab is active
    if not d(text=cfg.POPUP_CONCISE_TAB_TEXT).exists(timeout=cfg.POPUP_APPEAR_TIMEOUT):
        return None

    # Collect text iteratively while scrolling
    seen_blocks: list[str] = []
    prev_snapshot = ""

    for _ in range(30):  # max 30 scroll steps — prevents infinite loop
        # Grab all visible text nodes inside the popup
        snapshot = _collect_visible_text(d)
        if snapshot == prev_snapshot:
            break  # no new content after scroll
        prev_snapshot = snapshot

        # Scroll down inside popup
        d.swipe(0.5, 0.75, 0.5, 0.35, duration=0.3)
        time.sleep(cfg.SCROLL_PAUSE)

    full_text = snapshot.strip()
    if not full_text:
        return None

    start, end, range_str = _parse_range(full_text)

    # Fallback: trust the ayah we pressed
    if start is None:
        start = expected_ayah
        end = expected_ayah
        range_str = None

    return PopupContent(
        raw_text=full_text,
        range_str=range_str,
        start_ayah=start,
        end_ayah=end,
    )


def _collect_visible_text(d) -> str:
    """
    Walk the UI hierarchy and collect text from all visible nodes
    that are inside the popup area (lower 80% of screen).
    """
    try:
        info = d.info
        screen_height = info.get("displayHeight", 1920)
        popup_top = screen_height * 0.2   # popup occupies bottom ~80%

        blocks: list[str] = []
        for node in d.dump_hierarchy(compressed=False).split("<node"):
            text = _attr(node, "text")
            bounds = _parse_bounds(_attr(node, "bounds"))
            if not text or not text.strip():
                continue
            if bounds and bounds[1] < popup_top:
                continue    # skip elements above the popup
            blocks.append(text.strip())

        return "\n".join(blocks)
    except Exception:
        return ""


def _attr(node_str: str, attr: str) -> str:
    m = re.search(rf'{attr}="([^"]*)"', node_str)
    return m.group(1) if m else ""


def _parse_bounds(bounds_str: str) -> tuple[int, int, int, int] | None:
    """Parse '[x1,y1][x2,y2]' → (x1, y1, x2, y2)."""
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds_str)
    if m:
        return tuple(int(x) for x in m.groups())
    return None
