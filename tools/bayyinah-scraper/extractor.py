from __future__ import annotations
"""
Text extraction and parsing for the AyahByAyah popup.

The popup renders the full commentary as a single TextView inside a ScrollView.
dump_hierarchy() captures the complete text without needing to scroll,
so extraction is a single hierarchy dump + parse.
"""

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import config as cfg


@dataclass
class PopupContent:
    raw_text: str               # full description text (stripped)
    range_str: str | None       # "1-3" if grouped, None if single
    start_ayah: int             # first ayah covered
    end_ayah: int               # last ayah covered (== start_ayah if single)


# ─── Range detection ─────────────────────────────────────────────────────────

_GROUPED_PATTERN = re.compile(r"Ayahs?\s+(\d+)\s*[-–—\u2011\u2012\u2013\u2014]\s*(\d+)", re.IGNORECASE)
_SINGLE_PATTERN  = re.compile(r"Ayah\s+(\d+)", re.IGNORECASE)

# Matches "Ayah N" as a standalone heading (surrounded by newlines or start/end).
_AYAH_HEADING = re.compile(r"(?:^|\n\n)(Ayah\s+(\d+)(?:\n|$))", re.IGNORECASE)


def _parse_range(text: str) -> tuple[int | None, int | None, str | None]:
    m = _GROUPED_PATTERN.search(text)
    if m:
        s, e = int(m.group(1)), int(m.group(2))
        return s, e, f"{s}-{e}"
    m = _SINGLE_PATTERN.search(text)
    if m:
        n = int(m.group(1))
        return n, n, None
    return None, None, None


def split_ayah_sections(text: str, start_ayah: int, end_ayah: int) -> dict[int, str]:
    """
    Split a grouped popup description into per-ayah slices.

    The popup text structure (joined with double-newlines):
        Surah ...: Ayahs X-Y            ← header (discarded)
        Ayah X                          ← heading
        [Arabic text]
        [description paragraphs...]
        Ayah X+1                        ← heading
        [Arabic text]
        [description paragraphs...]
        ...

    Returns {ayah_number: section_text} for each ayah in [start_ayah, end_ayah].
    Falls back to the full text for every ayah if splitting fails.
    """
    # Split at every "\n\nAyah N\n" boundary, keeping the heading in each part.
    # The lookahead ensures "Ayah N" stays at the start of its part.
    parts = re.split(r"\n\n(?=Ayah\s+\d+(?:\n|$))", text, flags=re.IGNORECASE)

    sections: dict[int, str] = {}
    for part in parts:
        m = re.match(r"Ayah\s+(\d+)", part.strip(), re.IGNORECASE)
        if m:
            ayah_num = int(m.group(1))
            sections[ayah_num] = part.strip()

    if not sections:
        # Splitting failed — give every ayah the full text (safe fallback)
        return {a: text for a in range(start_ayah, end_ayah + 1)}

    return sections


# ─── Main extraction ─────────────────────────────────────────────────────────

def extract(d, expected_ayah: int) -> PopupContent | None:
    """
    Extract the commentary text from the open popup.

    The AyahByAyah app renders the full text in a single TextView inside a ScrollView.
    Content is loaded asynchronously — we wait for the ProgressBar to disappear
    before reading the final text.

    Returns PopupContent or None if the popup is not detected.
    """
    import time

    if not d(text=cfg.POPUP_CONCISE_TAB_TEXT).exists(timeout=cfg.POPUP_APPEAR_TIMEOUT):
        return None

    # Wait for content to finish loading (ProgressBar disappears)
    root = None
    text = None
    for _ in range(40):  # up to 20 seconds
        time.sleep(0.5)
        try:
            xml_str = d.dump_hierarchy()
            root = ET.fromstring(xml_str)
        except Exception:
            continue

        has_spinner = any(
            n.attrib.get("class", "").endswith("ProgressBar")
            for n in root.iter()
        )
        if not has_spinner:
            text = _find_ayah_text(root)
            # Whether we found text or not, loading is done — stop polling
            break
    else:
        # Timed out — try reading whatever we have
        if root is not None:
            text = _find_ayah_text(root)

    if not text:
        return None

    start, end, range_str = _parse_range(text)
    if start is None:
        start = expected_ayah
        end   = expected_ayah
        range_str = None

    return PopupContent(
        raw_text=text.strip(),
        range_str=range_str,
        start_ayah=start,
        end_ayah=end,
    )


_TAB_NAMES = {"Listen", "Concise", "Deeper Look", "Ask Ustadh", "Commentary coming soon"}


def _find_ayah_text(root: ET.Element) -> str | None:
    """
    Collect all commentary text from the popup's scrollable content area.

    Strategy:
    1. Find the large scrollable View that contains the popup content
       (the one that spans most of the screen height, below the tab row).
    2. Collect all descendant TextViews with non-empty text, skipping
       known tab-label strings.
    3. Concatenate with double-newlines and return.

    Falls back to a flat walk if no scrollable area is found.
    """
    import re

    def _is_content_scrollable(node: ET.Element) -> bool:
        if node.attrib.get("scrollable") != "true":
            return False
        b = node.attrib.get("bounds", "")
        nums = list(map(int, re.findall(r"\d+", b)))
        if len(nums) < 4:
            return False
        # Must span a tall region (at least 400px tall) starting below status bar
        return (nums[1] > 100) and ((nums[3] - nums[1]) > 400)

    def _collect_text(node: ET.Element) -> list[str]:
        parts = []
        for n in node.iter():
            t = n.attrib.get("text", "").strip()
            if t and t not in _TAB_NAMES:
                parts.append(t)
        return parts

    # Try to find the content scrollable View first
    for node in root.iter():
        if _is_content_scrollable(node):
            parts = _collect_text(node)
            if parts:
                return "\n\n".join(parts)

    # Fallback: look for any TextView whose text starts with "Ayah"
    for node in root.iter():
        text = node.attrib.get("text", "")
        if text and re.match(r"Ayahs?\s+\d+", text, re.IGNORECASE):
            return text

    return None
