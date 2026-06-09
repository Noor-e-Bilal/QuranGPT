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

    Root-cause history:
      Fix 1-3 used d.swipe() with fixed screen coordinates.  These failed because
      the BottomSheetDialog intercepts upward swipe gestures as "expand sheet" or
      "dismiss sheet" actions before they reach the inner RecyclerView content.

    Fix 4 — accessibility-based scrolling:
      Use UIAutomator2's scroll.forward() / scroll.to() which dispatch Android's
      ACTION_SCROLL_FORWARD accessibility action directly on the target View.
      This bypasses all touch-gesture interceptors (BottomSheet, CoordinatorLayout)
      and reliably scrolls only the intended RecyclerView.

      The popup is the LAST scrollable in the hierarchy (it renders on top of the
      background Quran reader), so we always target instance=(count-1).

    Visibility check:
      d(text=...).exists is faster than a full dump_hierarchy() parse and
      sufficient for yes/no "is the heading visible?" queries.

    Returns (found, root_at_target).
    """
    import time

    def _ayah_exists():
        """
        Check if the section for target_ayah is currently on screen.

        The popup stores each ayah's section as ONE large TextView whose text
        starts with "Ayah N\\n\\n[Arabic]\\n\\n[Commentary]...".  We cannot use
        text= (exact match) — we need textStartsWith or textContains.
        Try both to handle potential whitespace/encoding variations.
        """
        try:
            heading = f"Ayah {target_ayah}"
            # textContains with trailing \n is delimiter-safe (won't confuse
            # "Ayah 23" with "Ayah 230").  textStartsWith is a fallback only.
            return (
                d(textContains=f"{heading}\n").exists(timeout=0.3)
                or d(textStartsWith=f"{heading}\n").exists(timeout=0.3)
            )
        except Exception:
            return False

    def _dump():
        try:
            return ET.fromstring(d.dump_hierarchy())
        except Exception:
            return None

    def _visible(root):
        target_re = re.compile(
            rf'(?:^|\n\n?)Ayah\s+{target_ayah}(?:\W|$)', re.IGNORECASE | re.MULTILINE
        )
        return any(
            target_re.search(n.attrib.get("text", ""))
            for n in root.iter()
        )

    # ── check already visible (fast path) ───────────────────────────────────
    if _ayah_exists():
        root = _dump()
        return (True, root) if root else (False, None)

    # ── find the popup scrollable (LAST in hierarchy = topmost view) ─────────
    def _last_scroll():
        try:
            count = d(scrollable=True).count
            return d(scrollable=True, instance=max(count - 1, 0))
        except Exception:
            return d(scrollable=True)

    # ── Strategy 1: UIAutomator2 scroll.to() on the popup scrollable ─────────
    # scroll.to() calls ACTION_SCROLL_FORWARD repeatedly until the target text
    # is visible — completely bypass touch-gesture interceptors.
    # Use textStartsWith because each section is one big TextView starting with
    # "Ayah N\n\n[Arabic]\n\n..." — exact text= match would never succeed.
    try:
        popup_scroll = _last_scroll()
        heading = f"Ayah {target_ayah}"
        # Use textContains with trailing \n so "Ayah 23" doesn't match "Ayah 230".
        found_s1 = (
            popup_scroll.scroll.to(textContains=f"{heading}\n")
            or popup_scroll.scroll.to(textContains=heading)  # fallback
        )
        if found_s1:
            time.sleep(0.5)
            if _ayah_exists():
                root = _dump()
                return (True, root) if root else (False, None)
    except Exception:
        pass

    # ── Strategy 2: manual scroll.forward() loop on popup scrollable ─────────
    # For cases where scroll.to() can't find the text (e.g., heading uses a
    # compound text node), scroll step-by-step and check after each step.
    popup_scroll = _last_scroll()
    last_root = _dump()
    stall = 0

    for _ in range(max_scrolls):
        try:
            can_scroll = popup_scroll.scroll.forward(steps=10)
        except Exception:
            can_scroll = False

        time.sleep(1.0)  # let RecyclerView render newly visible items

        if _ayah_exists():
            root = _dump()
            return (True, root) if root else (False, last_root)

        if not can_scroll:
            stall += 1
            if stall >= 2:
                break   # reached bottom of popup content
        else:
            stall = 0
            # Update last_root only when content has advanced (avoid holding
            # a stale tree from before any scrolling occurred)
            new_root = _dump()
            if new_root is not None:
                last_root = new_root

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
