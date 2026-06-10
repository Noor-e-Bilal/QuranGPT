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

def _find_popup_scroll(d):
    """
    Return a UIAutomator2 selector for the popup's inner ScrollView.

    Targets android.widget.ScrollView by class to avoid the outer
    android.view.View BottomSheet wrapper (which slides down on scroll.forward).
    If multiple ScrollViews match, takes instance=count-1 (popup renders last).
    """
    for cls in ("android.widget.ScrollView",
                "androidx.core.widget.NestedScrollView"):
        try:
            count = d(className=cls, scrollable=True).count
            if count > 0:
                return d(className=cls, scrollable=True, instance=count - 1)
        except Exception:
            continue
    return d(className="android.widget.ScrollView")


def _get_popup_swipe_coords(d) -> tuple[int, int, int, int]:
    """
    Return (fx, fy, tx, ty) for an upward swipe within the popup ScrollView.

    Swipe from 70% → 25% of ScrollView height (fast, duration=0.3 s).
    Starting in the lower portion avoids the BottomSheet drag handle at the top.
    Hardcoded fallback from debug_1_2.xml bounds [0,677][1080,2339].
    """
    try:
        sw = _find_popup_scroll(d)
        if sw.exists(timeout=0.5):
            info = sw.info
            b = info.get('bounds', {})
            top = b.get('top', 677)
            bottom = b.get('bottom', 2339)
            right = b.get('right', 1080)
            cx = right // 2
            return (cx, top + int((bottom - top) * 0.70),
                    cx, top + int((bottom - top) * 0.25))
    except Exception:
        pass
    return (540, 1840, 540, 1093)


def _root_fingerprint_fn(root: ET.Element | None) -> tuple[str, int]:
    """
    Returns (text, top_y) for scroll stall detection.

    Text alone is insufficient when scrolling through a large single ViewHolder
    (text is constant but y-position changes on each swipe).
    """
    if root is None:
        return ("", -1)
    text = " ".join(n.attrib.get("text", "") for n in root.iter())
    top_y = -1
    for node in root.iter():
        t = node.attrib.get("text", "").strip()
        if len(t) < 30:
            continue
        b = node.attrib.get("bounds", "")
        nums = list(map(int, re.findall(r"\d+", b)))
        if len(nums) >= 4:
            top_y = nums[1]
            break
    return (text, top_y)



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

    # ── find the popup's inner ScrollView ────────────────────────────────────
    # IMPORTANT: target android.widget.ScrollView by class name — see
    # _find_popup_scroll() for the full rationale.
    def _popup_scroll():
        return _find_popup_scroll(d)

    # ── Strategy 1: UIAutomator2 scroll.to() on the popup ScrollView ─────────
    # scroll.to() calls UiScrollable.scrollIntoView(UiSelector) → dispatches
    # ACTION_SCROLL_FORWARD accessibility actions on the inner ScrollView only.
    # Use textContains with trailing \n as delimiter so "Ayah 23" won't match
    # "Ayah 230".
    try:
        popup_scroll = _popup_scroll()
        heading = f"Ayah {target_ayah}"
        found_s1 = (
            popup_scroll.scroll.to(textContains=f"{heading}\n")
            or popup_scroll.scroll.to(textContains=heading)  # fallback: no \n
        )
        if found_s1:
            time.sleep(0.5)
            if _ayah_exists():
                root = _dump()
                return (True, root) if root else (False, None)
    except Exception:
        pass

    # ── Strategy 2: touch swipe within popup content area ────────────────────
    # scroll.forward() (accessibility action) returns False immediately on this
    # popup — the app's canScrollForward() is misconfigured even though the view
    # IS scrollable via touch.  Fall back to a raw d.swipe() gesture.
    #
    # Swipe UP (finger moves up = content reveals what's below) from within the
    # LOWER portion of the ScrollView so the BottomSheet drag handle at the top
    # doesn't intercept the gesture.

    last_root = _dump()
    last_fp = _root_fingerprint_fn(last_root)
    stall = 0
    fx, fy, tx, ty = _get_popup_swipe_coords(d)

    for _ in range(max_scrolls):
        try:
            d.swipe(fx, fy, tx, ty, duration=0.3)
        except Exception:
            pass

        time.sleep(2.0)  # let content render after swipe (increased for slow ViewHolder loads)

        if _ayah_exists():
            root = _dump()
            return (True, root) if root else (False, last_root)

        new_root = _dump()
        new_fp = _root_fingerprint_fn(new_root)

        is_transitional = new_fp[1] == -1  # no substantial nodes — RecyclerView between ViewHolders
        if is_transitional:
            # Don't count as stall: content is loading between sections; wait for it
            stall = 0
        elif new_fp == last_fp:
            stall += 1
            if stall >= 5:  # increased from 3: tolerate slow section loads
                break  # truly stuck — swipe not landing or at bottom
        else:
            stall = 0
            # Only update last_root/fp from a valid dump to avoid losing the
            # last known good position on transient dump failures.
            if new_root is not None:
                last_root = new_root
                last_fp = new_fp

    return False, last_root


def extract_full_range(d, start_ayah: int, end_ayah: int) -> dict[int, str]:
    """
    Extract ALL section texts from a range popup in a single popup open.

    The popup opens at start_ayah.  This function scrolls from top to bottom,
    harvesting every "Ayah N" ViewHolder node that becomes visible.  Sections
    are returned as {ayah_num: section_text} for the full range.

    This replaces the per-ayah scroll approach which suffered from:
      - max_scrolls=25 too small for large ranges (e.g., 31-69 = 39 ayahs)
      - per-ayah re-open causing cycling duplicates when scroll didn't reach target
      - long processing time (N popup opens per N-ayah range)

    Returns {ayah_num: section_text}.  Ayahs not found get the initial raw text
    as fallback so callers always have something to store.
    """
    import time

    sections: dict[int, str] = {}

    def _dump():
        try:
            return ET.fromstring(d.dump_hierarchy())
        except Exception:
            return None

    def _harvest(root: ET.Element | None) -> None:
        """
        Collect section texts from the currently visible hierarchy.

        Uses _find_ayah_text() to get all visible text concatenated with \\n\\n,
        then splits at "Ayah N" heading boundaries.

        Why not match individual nodes:
          The popup uses SEPARATE TextViews — one node for the "Ayah N" heading
          (text = "Ayah 221", no trailing newline), one for Arabic, one for commentary.
          re.match(r"Ayah N\\n") on "Ayah 221" always fails.
          _find_ayah_text() concatenates those nodes; split_ayah_sections() handles
          that concatenated format correctly.

        Intentionally omits the fallback in split_ayah_sections() that assigns the
        full text to every ayah when splitting fails — that would re-introduce duplicates.
        """
        if root is None:
            return
        visible_text = _find_ayah_text(root)
        if not visible_text:
            return
        # Split at \\n\\nAyah N\\n (or \\n\\nAyah N$) — same logic as split_ayah_sections
        # but WITHOUT the fallback that assigns full text to every ayah on failure.
        parts = re.split(r"\n\n(?=Ayah\s+\d+(?:\n|$))", visible_text, flags=re.IGNORECASE)
        for part in parts:
            m = re.match(r"Ayah\s+(\d+)", part.strip(), re.IGNORECASE)
            if not m:
                continue
            ayah_num = int(m.group(1))
            if start_ayah <= ayah_num <= end_ayah:
                section_text = part.strip()
                # Prefer longer over first-wins: a later swipe may reveal more
                # content for the same section (e.g., heading appeared near the
                # viewport bottom on the first capture, full commentary not yet loaded).
                if len(section_text) > len(sections.get(ayah_num, "")):
                    sections[ayah_num] = section_text

    # Wait for popup to load
    if not d(text=cfg.POPUP_CONCISE_TAB_TEXT).exists(timeout=cfg.POPUP_APPEAR_TIMEOUT):
        return {}

    for _ in range(40):
        time.sleep(0.5)
        root = _dump()
        if root is not None:
            has_spinner = any(
                n.attrib.get("class", "").endswith("ProgressBar") for n in root.iter()
            )
            if not has_spinner:
                break

    # NOTE: The caller (scraper.py) must call extract(d, ayah, skip_scroll=True) so
    # the popup is still at the range start when we begin harvesting here.
    # A downward-swipe "scroll to top" would dismiss the BottomSheet — don't attempt it.

    # Initial harvest (popup at range start = start_ayah)
    root = _dump()
    _harvest(root)

    # Scroll all the way to the bottom, harvesting new sections as they appear
    fx, fy, tx, ty = _get_popup_swipe_coords(d)
    last_fp = _root_fingerprint_fn(root)
    stall = 0

    for _ in range(150):  # generous limit: 150 swipes × ~600 px = ~90,000 px
        # Stop early if we have every section
        if all(a in sections for a in range(start_ayah, end_ayah + 1)):
            break

        try:
            d.swipe(fx, fy, tx, ty, duration=0.3)
        except Exception:
            pass

        time.sleep(2.0)  # let content render (increased for slow ViewHolder loads)

        new_root = _dump()
        _harvest(new_root)

        new_fp = _root_fingerprint_fn(new_root)
        is_transitional = new_fp[1] == -1  # no substantial nodes — RecyclerView between ViewHolders
        if is_transitional:
            # Don't count as stall: content is loading between sections
            stall = 0
        elif new_fp == last_fp:
            stall += 1
            if stall >= 5:  # increased from 3: tolerate slow section loads
                break  # reached bottom or swipe isn't landing
        else:
            stall = 0
            if new_root is not None:
                last_fp = new_fp

    # Return only what was actually harvested.
    # Missing sections are NOT filled with initial_text — the caller's cache-eviction
    # logic will re-extract them on the next encounter rather than silently storing
    # wrong text (the range-start section) for every unharvested ayah.
    return sections


def extract(d, expected_ayah: int, skip_scroll: bool = False) -> PopupContent | None:
    """
    Extract the commentary text from the open popup.

    For single-ayah popups a single hierarchy dump is enough.
    For grouped-range popups the popup opens at the first ayah in the range;
    by default we scroll within the popup to bring expected_ayah into view.

    Pass skip_scroll=True when the caller will follow up with extract_full_range() —
    this keeps the popup positioned at the range start so full-range harvesting
    begins at the top.  (Downward swipes to scroll back to top dismiss the sheet.)

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
    # scroll within the popup to bring the target ayah section into view —
    # unless skip_scroll=True (caller will use extract_full_range instead).
    if (
        not skip_scroll
        and start is not None
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
