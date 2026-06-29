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

    Some popups use SEPARATE TextViews per heading (no \n between heading
    and content), so we try \n\n first, then fall back to direct heading
    scanning if that yields only 0-1 sections.

    Returns {ayah_number: section_text} for each ayah in [start_ayah, end_ayah].
    Falls back to the full text for every ayah if splitting fails.
    """
    sections: dict[int, str] = {}

    def _try_split(sep: str) -> dict[int, str]:
        out = {}
        parts = re.split(
            rf"{sep}(?=Ayah\s+\d+(?:\n|$))", text, flags=re.IGNORECASE
        )
        for part in parts:
            m = re.match(r"Ayah\s+(\d+)", part.strip(), re.IGNORECASE)
            if m:
                ayah_num = int(m.group(1))
                out[ayah_num] = part.strip()
        return out

    # Strategy 1: split on \n\n (most common in joined-TextView format)
    sections = _try_split(r"\n\n")
    valid = sum(1 for a in range(start_ayah, end_ayah + 1) if a in sections)

    # Strategy 2: if \n\n yielded < 50% coverage, try \n
    if valid < (end_ayah - start_ayah + 1) * 0.5:
        sections = _try_split(r"\n")

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
    d, target_ayah: int, max_scrolls: int = 40
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

        For single-TextView sections the heading has a trailing \n:
            "Ayah 221\n\nArabic\n\nCommentary..."
        For SEPARATE-TextView sections the heading node has ONLY the number:
            "Ayah 221" (no trailing \n)

        We try exact match (no \n) first for the separate-TextView case,
        then textContains with \n for the single-TextView case.
        """
        try:
            heading = f"Ayah {target_ayah}"
            return (
                d(text=heading).exists(timeout=0.3)
                or d(textStartsWith=f"{heading}\n").exists(timeout=0.3)
                or d(textContains=f"{heading}\n").exists(timeout=0.3)
            )
        except Exception:
            return False

    def _dump():
        try:
            return ET.fromstring(d.dump_hierarchy())
        except Exception:
            return None

    def _visible(root):
        for n in root.iter():
            t = n.attrib.get("text", "")
            if not t:
                continue
            if re.match(rf"Ayah\s+{target_ayah}\s*$", t, re.IGNORECASE):
                return True
            if re.search(rf"Ayah\s+{target_ayah}(?:\W|$)", t, re.IGNORECASE):
                return True
        return False

    # ── check already visible (fast path) ───────────────────────────────────
    if _ayah_exists():
        root = _dump()
        return (True, root) if root else (False, None)

    # ── find the popup's inner ScrollView ────────────────────────────────────
    def _popup_scroll():
        return _find_popup_scroll(d)

    # ── Strategy 1: UIAutomator2 scroll.to() on the popup ScrollView ─────────
    try:
        popup_scroll = _popup_scroll()
        heading = f"Ayah {target_ayah}"
        found_s1 = (
            popup_scroll.scroll.to(textContains=f"{heading}\n")
            or popup_scroll.scroll.to(textContains=heading)
        )
        if found_s1:
            time.sleep(1.0)  # increased from 0.5: let content fully render
            if _ayah_exists():
                root = _dump()
                return (True, root) if root else (False, None)
    except Exception:
        pass

    # ── Strategy 2: touch swipe within popup content area ────────────────────
    # scroll.forward() (accessibility action) returns False immediately on this
    # popup — the app's canScrollForward() is misconfigured even though the view
    # IS scrollable via touch.  Fall back to a raw d.swipe() gesture.

    last_root = _dump()
    last_fp = _root_fingerprint_fn(last_root)
    stall = 0
    fx, fy, tx, ty = _get_popup_swipe_coords(d)
    no_progress_count = 0

    for _ in range(max_scrolls):
        try:
            d.swipe(fx, fy, tx, ty, duration=0.3)
        except Exception:
            pass

        time.sleep(2.0)

        if _ayah_exists():
            root = _dump()
            return (True, root) if root else (False, last_root)

        new_root = _dump()
        new_fp = _root_fingerprint_fn(new_root)

        is_transitional = new_fp[1] == -1
        if is_transitional:
            stall = 0
        elif new_fp == last_fp:
            stall += 1
            if stall >= 8:
                no_progress_count += 1
                if no_progress_count >= 2:
                    break  # truly stuck after two stall cycles
                stall = 0  # reset and try once more
        else:
            stall = 0
            no_progress_count = 0
            if new_root is not None:
                last_root = new_root
                last_fp = new_fp

    return False, last_root


def extract_full_range(d, start_ayah: int, end_ayah: int) -> dict[int, str]:
    """
    Extract as many ayah sections as possible from the range popup.

    Uses short touch swipes (200 px upward — less triggering of the
    BottomSheet drag gesture).  If 3 consecutive swipes produce no
    change in the visible popup text the function bails out immediately
    and returns whatever sections it harvested so far.

    Returns {ayah_num: section_text}.  Missing sections are left out.
    """
    import time

    sections: dict[int, str] = {}

    def _dump():
        try:
            return ET.fromstring(d.dump_hierarchy())
        except Exception:
            return None

    def _harvest(root: ET.Element | None) -> int:
        if root is None:
            return 0
        before = len(sections)

        visible_text = _find_ayah_text(root)
        if visible_text:
            for sep in (r"\n\n", r"\n"):
                parts = re.split(
                    rf"{sep}(?=Ayah\s+\d+(?:\n|$))", visible_text, flags=re.IGNORECASE
                )
                ayah_count = sum(
                    1 for p in parts if re.match(r"Ayah\s+\d+", p.strip(), re.IGNORECASE)
                )
                if ayah_count > 1:
                    for part in parts:
                        m = re.match(r"Ayah\s+(\d+)", part.strip(), re.IGNORECASE)
                        if not m:
                            continue
                        ayah_num = int(m.group(1))
                        if start_ayah <= ayah_num <= end_ayah:
                            section_text = part.strip()
                            if len(section_text) > len(sections.get(ayah_num, "")):
                                sections[ayah_num] = section_text
                    break

        _collect_raw_sections(root, sections, start_ayah, end_ayah)
        return len(sections) - before

    def _collect_raw_sections(
        root: ET.Element, out: dict[int, str], sa: int, ea: int
    ) -> None:
        nodes: list[tuple[ET.Element, str]] = []
        for n in root.iter():
            t = n.attrib.get("text", "")
            if t and t.strip() and t not in _TAB_NAMES:
                nodes.append((n, t.strip()))
        i = 0
        while i < len(nodes):
            _n, t = nodes[i]
            m = re.match(r"Ayah\s+(\d+)", t, re.IGNORECASE)
            if m and sa <= int(m.group(1)) <= ea:
                ayah_num = int(m.group(1))
                group_parts = [t]
                i += 1
                while i < len(nodes):
                    if re.match(r"Ayah\s+\d+", nodes[i][1], re.IGNORECASE):
                        break
                    group_parts.append(nodes[i][1])
                    i += 1
                section_text = "\n\n".join(group_parts)
                if len(section_text) > len(out.get(ayah_num, "")):
                    out[ayah_num] = section_text
            else:
                i += 1

    # ── Wait for popup to appear and content to load ──────────────────────
    if not d(text=cfg.POPUP_CONCISE_TAB_TEXT).exists(timeout=cfg.POPUP_APPEAR_TIMEOUT):
        return {}

    for _ in range(20):
        time.sleep(0.5)
        root = _dump()
        if root is not None:
            has_spinner = any(
                n.attrib.get("class", "").endswith("ProgressBar") for n in root.iter()
            )
            if not has_spinner:
                break

    fx, fy, tx, ty = _get_popup_swipe_coords(d)

    # ── Harvest initial visible content ──────────────────────────────────
    for _ in range(10):
        time.sleep(0.5)
        root = _dump()
        _harvest(root)

    def _all_done():
        return all(a in sections for a in range(start_ayah, end_ayah + 1))

    def _popup_text(root) -> str:
        """Return visible text from the popup for change detection."""
        text = _find_ayah_text(root)
        if text:
            return text.strip()
        return ""

    # ── Scroll-harvest loop ─────────────────────────────────────────────
    # The LazyColumn loads content asynchronously — items may appear in
    # the accessibility tree over 30-60 s even without scrolling.  We keep
    # polling for 6 s after every swipe attempt to catch async loads.
    #
    # Uses the FULL default scroll distance (~750 px, same as
    # _scroll_popup_to_ayah which WORKS).  Previously a 200 px reduction
    # was too short to trigger RecyclerView view rebinding, causing every
    # swipe to show the same content and only the first ayah to be captured.
    no_change = 0
    last_text = ""

    for iteration in range(30):
        if _all_done():
            break

        r = _dump()
        _harvest(r)

        try:
            d.swipe(fx, fy, tx, ty, duration=0.3)
        except Exception:
            pass

        # Wait 6 s after swipe — async LazyColumn content needs time to bind
        for _ in range(12):
            time.sleep(0.5)
            r = _dump()
            _harvest(r)

        # Text-change bailout: 5 consecutive identical results = stuck
        r = _dump()
        current_text = _popup_text(r) or ""
        if current_text == last_text:
            no_change += 1
            if no_change >= 5:
                break
        else:
            no_change = 0
            last_text = current_text

    # ── Final prolonged harvest (up to 15 s) ────────────────────────────
    # Content sometimes trickles in well after the last swipe.
    for _ in range(30):
        time.sleep(0.5)
        r = _dump()
        _harvest(r)

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

    # Fallback: collect ALL text from the popup area (below tab row, above nav bar)
    # by finding the large content container and iterating its text children.
    for node in root.iter():
        b = node.attrib.get("bounds", "")
        nums = list(map(int, re.findall(r"\d+", b)))
        if len(nums) < 4:
            continue
        content_h = nums[3] - nums[1]
        if nums[1] > 500 and content_h > 200:
            parts = _collect_text(node)
            if parts:
                joined = "\n\n".join(parts)
                if re.search(r"Ayahs?\s+\d+", joined, re.IGNORECASE):
                    return joined

    return None
