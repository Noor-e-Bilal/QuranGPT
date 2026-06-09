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
    d, target_ayah: int, max_scrolls: int = 25
) -> tuple[bool, ET.Element | None]:
    """
    Scroll the popup's content area until the heading for target_ayah is visible.

    Why fixed coordinates:
      Android routes touch events to the TOPMOST view at the touch point.
      The popup covers the bottom ~60% of the screen and is always on top,
      so swiping between y=87% and y=60% of screen height will always be
      received by the popup regardless of what the background reader is doing.

    Stall detection:
      Uses _find_ayah_text() (popup-specific) as the change signal, NOT all
      nodes.  This prevents false progress when the background scrollable
      changes while the popup stays frozen.

    Strategy 1:
      UIAutomator2 native scroll.to() is tried first as a quick-win.

    Strategy 2:
      Fixed-coordinate swipe + popup-text-based stall detection.

    Returns (found, root_at_target).
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

    def _popup_sig(root):
        """Signature of popup-specific text only (ignores background nodes)."""
        return _find_ayah_text(root) or ""

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

    # ── Strategy 2: fixed-coordinate swipe (popup always receives it) ────────
    # Swipe from 87% → 60% of screen height: guaranteed inside popup content.
    # Popup typically starts at ~30-40% of screen height; this range stays
    # within the popup's scrollable content for any device size.
    info = d.info
    sw = info.get("displayWidth", 1080)
    sh = info.get("displayHeight", 2340)
    sx = sw // 2
    sy_start = int(sh * 0.87)
    sy_end   = int(sh * 0.60)

    prev_sig = _popup_sig(root) if root else ""
    stall = 0
    last_root = root  # track deepest scroll position reached

    for _ in range(max_scrolls):
        d.swipe(sx, sy_start, sx, sy_end, duration=0.5)
        time.sleep(0.35)

        root = _dump()
        if root is None:
            # Return best content reached so far even if target not confirmed
            return False, last_root
        if _visible(root):
            return True, root

        cur_sig = _popup_sig(root)
        if cur_sig == prev_sig:
            stall += 1
            if stall >= 3:
                break   # popup content frozen — single block or already at bottom
        else:
            stall = 0
            last_root = root  # content changed: save as best-so-far
        prev_sig = cur_sig

    # Return best-effort root even if target heading not found:
    # the caller's split_ayah_sections may still extract the right section.
    return False, last_root


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
        if scrolled_root is not None:
            # Use scrolled content whether or not exact target heading was confirmed.
            # If the popup has individual sections, scroll will have moved to a new
            # position and split_ayah_sections (in the caller) can extract the target.
            # If the popup is a single block, scrolled_root == root (no change) and
            # we fall back to the original text naturally.
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
