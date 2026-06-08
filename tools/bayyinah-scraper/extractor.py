from __future__ import annotations
"""
Text extraction and parsing for the AyahByAyah popup.

The popup content area is a RecyclerView — dump_hierarchy() only captures
what is currently visible on screen.  For grouped-range popups the popup
opens at the first ayah in the range; we scroll within the popup to bring
the target ayah's section into view before capturing.
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

def _last_popup_scrollable_bounds(root: ET.Element) -> tuple[int, int, int, int] | None:
    """
    Return (x0, y0, x1, y1) of the popup content scrollable area.

    Android renders the popup ABOVE the background Quran reader, so the popup's
    RecyclerView appears LATER in the accessibility tree.  We walk the entire
    tree and keep the LAST match so we target the popup, not the background.
    """
    result = None
    for node in root.iter():
        if node.attrib.get("scrollable") != "true":
            continue
        b = node.attrib.get("bounds", "")
        nums = list(map(int, re.findall(r"\d+", b)))
        if len(nums) < 4:
            continue
        x0, y0, x1, y1 = nums[:4]
        if y0 > 100 and (y1 - y0) > 400:
            result = (x0, y0, x1, y1)  # keep updating — want the LAST one
    return result


def _scroll_popup_to_ayah(
    d, target_ayah: int, max_scrolls: int = 20
) -> tuple[bool, ET.Element | None]:
    """
    Scroll the popup's content area until the heading for target_ayah is visible.

    Strategy (in order):
      1. UIAutomator2's native scroll.to(text=) — targets the correct scrollable
         automatically using the accessibility framework.
      2. Manual swipe against the LAST scrollable in the hierarchy (popup layers
         on top of the background reader, so it appears later in the tree).
         Includes stall-detection: if the highest visible ayah heading number
         does not increase after 3 consecutive dumps, we've hit the bottom.

    Returns (found, root_at_target) — root_at_target is the tree from the dump
    that first showed the target, so the caller avoids a redundant second dump.
    """
    import time

    target_re = re.compile(
        rf'(?:^|\n\n?)Ayah\s+{target_ayah}(?:\W|$)', re.IGNORECASE | re.MULTILINE
    )

    def _dump():
        try:
            return ET.fromstring(d.dump_hierarchy())
        except Exception:
            return None

    def _visible(root):
        return any(
            target_re.search(n.attrib.get("text", ""))
            for n in root.iter()
        )

    # ── check already visible ────────────────────────────────────────────────
    root = _dump()
    if root is None:
        return False, None
    if _visible(root):
        return True, root

    # ── Strategy 1: UIAutomator2 native scroll.to() ──────────────────────────
    try:
        if d(scrollable=True).scroll.to(text=f"Ayah {target_ayah}"):
            time.sleep(0.2)
            root = _dump()
            if root and _visible(root):
                return True, root
    except Exception:
        pass

    # ── Strategy 2: manual swipe on the LAST (popup) scrollable ─────────────
    # Stall on IDENTICAL VISIBLE TEXT rather than identical heading number:
    # a long Ayah 221 section may take many swipes before Ayah 222 appears,
    # but the heading count wouldn't advance.  Frozen text means we've hit the
    # bottom (or the wrong container).
    def _visible_text_sig(root):
        parts = sorted(
            n.attrib.get("text", "") for n in root.iter() if n.attrib.get("text", "")
        )
        return "||".join(parts)

    prev_sig = _visible_text_sig(root) if root else ""
    stall = 0

    for _ in range(max_scrolls):
        root = _dump()
        if root is None:
            return False, None
        if _visible(root):
            return True, root

        cur_sig = _visible_text_sig(root)
        if cur_sig and cur_sig == prev_sig:
            stall += 1
            if stall >= 3:
                break   # no content change = hit bottom or wrong container
        else:
            stall = 0
        prev_sig = cur_sig

        bounds = _last_popup_scrollable_bounds(root)
        if bounds:
            x0, y0, x1, y1 = bounds
            cx  = (x0 + x1) // 2
            h   = y1 - y0
            d.swipe(cx, y0 + int(h * 0.75), cx, y0 + int(h * 0.25), duration=0.5)
        else:
            info = d.info
            w = info.get("displayWidth", 1080)
            h = info.get("displayHeight", 2340)
            d.swipe(w // 2, h * 2 // 3, w // 2, h // 3, duration=0.5)

        time.sleep(0.3)

    return False, None


def extract(d, expected_ayah: int) -> PopupContent | None:
    """
    Extract the commentary text from the open popup.

    For single-ayah popups a single hierarchy dump is enough.
    For grouped-range popups the popup opens at the first ayah in the range;
    we scroll within the popup to bring expected_ayah into view first.

    Returns PopupContent or None if the popup is not detected.
    """
    import time

    if not d(text=cfg.POPUP_CONCISE_TAB_TEXT).exists(timeout=cfg.POPUP_APPEAR_TIMEOUT):
        return None

    # Wait for content to finish loading (ProgressBar disappears)
    root = None
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
            break
    # root may be None if every dump raised; proceed and handle below

    # Initial capture to detect range
    text: str | None = None
    if root is not None:
        text = _find_ayah_text(root)

    if not text:
        return None

    start, end, range_str = _parse_range(text)

    # If this is a grouped range and the target ayah is not the first one,
    # scroll within the popup to bring the target ayah section into view.
    if (
        start is not None
        and end is not None
        and expected_ayah != start
        and start <= expected_ayah <= end
    ):
        # Preserve original range metadata — scrolling may change what _parse_range sees
        orig_start, orig_end, orig_range_str = start, end, range_str
        found, scrolled_root = _scroll_popup_to_ayah(d, expected_ayah)
        if found and scrolled_root is not None:
            scrolled_text = _find_ayah_text(scrolled_root)
            if scrolled_text:
                text = scrolled_text
        # Restore original range metadata regardless of scroll outcome
        start, end, range_str = orig_start, orig_end, orig_range_str
    else:
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

    # Try to find the content scrollable View — use the LAST match (popup layers last)
    content_node = None
    for node in root.iter():
        if _is_content_scrollable(node):
            content_node = node
    if content_node is not None:
        parts = _collect_text(content_node)
        if parts:
            return "\n\n".join(parts)

    # Fallback: look for any TextView whose text starts with "Ayah"
    for node in root.iter():
        text = node.attrib.get("text", "")
        if text and re.match(r"Ayahs?\s+\d+", text, re.IGNORECASE):
            return text

    return None
