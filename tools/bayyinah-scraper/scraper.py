from __future__ import annotations
"""
Main automation logic for the Bayyinah scraper.

Controls the Android device via uiautomator2 over ADB:
  1. Navigate to Surahs tab
  2. Open a surah by English name
  3. Long-press each ayah marker → extract popup → store in DB
  4. Swipe right for next Quran page when needed
  5. Go back to surah list → next surah when surah is done
"""

import re
import time

import uiautomator2 as u2

import config as cfg
import db
import extractor
import progress as prog


class BayyinahScraper:

    SURAH_ENGLISH_NAMES = [
        "Al-Fatihah", "Al-Baqarah", "Ali 'Imran", "An-Nisa", "Al-Ma'idah",
        "Al-An'am", "Al-A'raf", "Al-Anfal", "At-Tawbah", "Yunus",
        "Hud", "Yusuf", "Ar-Ra'd", "Ibrahim", "Al-Hijr",
        "An-Nahl", "Al-Isra", "Al-Kahf", "Maryam", "Taha",
        "Al-Anbya", "Al-Hajj", "Al-Mu'minun", "An-Nur", "Al-Furqan",
        "Ash-Shu'ara", "An-Naml", "Al-Qasas", "Al-'Ankabut", "Ar-Rum",
        "Luqman", "As-Sajdah", "Al-Ahzab", "Saba", "Fatir",
        "Ya-Sin", "As-Saffat", "Sad", "Az-Zumar", "Ghafir",
        "Fussilat", "Ash-Shuraa", "Az-Zukhruf", "Ad-Dukhan", "Al-Jathiyah",
        "Al-Ahqaf", "Muhammad", "Al-Fath", "Al-Hujurat", "Qaf",
        "Adh-Dhariyat", "At-Tur", "An-Najm", "Al-Qamar", "Ar-Rahman",
        "Al-Waqi'ah", "Al-Hadid", "Al-Mujadila", "Al-Hashr", "Al-Mumtahanah",
        "As-Saf", "Al-Jumu'ah", "Al-Munafiqun", "At-Taghabun", "At-Talaq",
        "At-Tahrim", "Al-Mulk", "Al-Qalam", "Al-Haqqah", "Al-Ma'arij",
        "Nuh", "Al-Jinn", "Al-Muzzammil", "Al-Muddaththir", "Al-Qiyamah",
        "Al-Insan", "Al-Mursalat", "An-Naba", "An-Nazi'at", "'Abasa",
        "At-Takwir", "Al-Infitar", "Al-Mutaffifin", "Al-Inshiqaq", "Al-Buruj",
        "At-Tariq", "Al-A'la", "Al-Ghashiyah", "Al-Fajr", "Al-Balad",
        "Ash-Shams", "Al-Layl", "Ad-Duhaa", "Ash-Sharh", "At-Tin",
        "Al-'Alaq", "Al-Qadr", "Al-Bayyinah", "Az-Zalzalah", "Al-'Adiyat",
        "Al-Qari'ah", "At-Takathur", "Al-'Asr", "Al-Humazah", "Al-Fil",
        "Quraysh", "Al-Ma'un", "Al-Kawthar", "Al-Kafirun", "An-Nasr",
        "Al-Masad", "Al-Ikhlas", "Al-Falaq", "An-Nas",
    ]

    def __init__(self, device_serial: str | None = None):
        print(f"[scraper] Connecting to device{' '+device_serial if device_serial else ''}…")
        self.d = u2.connect(device_serial)
        self.d.implicitly_wait(cfg.ELEMENT_TIMEOUT)
        self.conn = db.init_db()
        print(f"[scraper] DB ready — {db.scraped_count(self.conn)} ayahs already scraped")

    # ─── Navigation ──────────────────────────────────────────────────────────

    def navigate_to_surahs_tab(self) -> None:
        """Tap the Surahs tab in the bottom nav bar, backing out of any reading view first."""
        # Press back up to 3 times to reach a screen where the Surahs tab is visible
        for _ in range(3):
            if self.d(text=cfg.SURAHS_TAB_TEXT).exists(timeout=2):
                break
            self.d.press("back")
            time.sleep(cfg.BACK_PAUSE)

        tab = self.d(text=cfg.SURAHS_TAB_TEXT)
        if not tab.exists(timeout=5):
            raise RuntimeError(
                f"Could not find '{cfg.SURAHS_TAB_TEXT}' tab. "
                "Run --discover to inspect the UI hierarchy."
            )
        tab.click()
        time.sleep(0.8)

    def open_surah(self, surah_number: int) -> None:
        """
        Navigate to a specific surah from the Surahs tab list.
        Scrolls to the surah name and taps it.
        """
        name = self.SURAH_ENGLISH_NAMES[surah_number - 1]
        print(f"[scraper] Opening Surah {surah_number}: {name}")

        # Scroll the list to find the surah name, then tap it
        if not self.d(text=name).exists(timeout=2):
            self.d(scrollable=True).scroll.to(text=name)

        el = self.d(text=name)
        if not el.exists(timeout=5):
            raise RuntimeError(f"Surah '{name}' not found in Surahs list")
        el.click()
        time.sleep(1.0)

    # ─── Ayah interaction ────────────────────────────────────────────────────

    def find_verse_markers(self) -> list[tuple[int, int, int]]:
        """
        Find ayah verse-number markers visible on the current screen.
        Returns list of (ayah_number, center_x, center_y) sorted top→bottom, left→right.

        Strategy:
          1. By resource ID (if configured)
          2. By content-description prefix (if configured)
          3. Auto-detect: small elements containing only a number near Arabic text
        """
        results: list[tuple[int, int, int]] = []

        # Strategy 1: explicit resource ID
        if cfg.VERSE_MARKER_RESOURCE_ID:
            els = self.d(resourceId=cfg.VERSE_MARKER_RESOURCE_ID)
            for i in range(els.count):
                el = els[i]
                n = _parse_num(el.info.get("text", "") or el.info.get("contentDescription", ""))
                if n:
                    b = el.info["bounds"]
                    cx = (b["left"] + b["right"]) // 2
                    cy = (b["top"] + b["bottom"]) // 2
                    results.append((n, cx, cy))

        # Strategy 2: content-description prefix
        if not results and cfg.VERSE_MARKER_CONTENT_DESC_PREFIX:
            pattern = f"{cfg.VERSE_MARKER_CONTENT_DESC_PREFIX}*"
            els = self.d(descriptionMatches=pattern)
            for i in range(els.count):
                el = els[i]
                n = _parse_num(el.info.get("contentDescription", ""))
                if n:
                    b = el.info["bounds"]
                    cx = (b["left"] + b["right"]) // 2
                    cy = (b["top"] + b["bottom"]) // 2
                    results.append((n, cx, cy))

        # Strategy 3: auto-detect small number-only elements
        if not results:
            results = self._autodetect_verse_markers()

        return sorted(results, key=lambda e: (e[2], e[1]))

    def _autodetect_verse_markers(self) -> list[tuple[int, int, int]]:
        """
        Walk the UI hierarchy and find small elements whose text is a
        short Arabic-Indic or ASCII number string (verse number circles).
        Uses proper XML parsing to handle single-quoted attributes.
        """
        results = []
        try:
            import xml.etree.ElementTree as ET
            hierarchy = self.d.dump_hierarchy()
            root = ET.fromstring(hierarchy)
            screen_h = self.d.info.get("displayHeight", 2412)
            bottom_cutoff = self._detect_bottom_nav_top(root, screen_h)
            for node in root.iter():
                text = node.attrib.get("text", "")
                if not text:
                    continue
                n = _parse_num(text)
                if n is None:
                    continue
                bounds_str = node.attrib.get("bounds", "")
                b = _parse_bounds(bounds_str)
                if b is None:
                    continue
                w = b[2] - b[0]
                h = b[3] - b[1]
                cy = (b[1] + b[3]) // 2
                # Verse number circles are narrow, and above the bottom UI bar
                if 4 < w < 80 and 4 < h < 80 and cy < bottom_cutoff:
                    cx = (b[0] + b[2]) // 2
                    results.append((n, cx, cy))
        except Exception as e:
            print(f"[scraper] Warning: autodetect failed — {e}")
        return results

    @staticmethod
    def _detect_bottom_nav_top(root, screen_h: int) -> int:
        """
        Locate the bottom navigation bar by finding the 'Page N' element
        and return its top y-coordinate.  This is used as the marker cutoff
        so ayahs at the very bottom of the reading area (like ayah 29 on
        Al-Baqarah page 5) are not accidentally excluded.

        Falls back to 92% of screen height if the bar cannot be found.
        """
        import re
        for node in root.iter():
            t = node.attrib.get("text", "")
            b = node.attrib.get("bounds", "")
            if b and re.search(r'\bPage\s+\d+', t):
                nums = list(map(int, re.findall(r'\d+', b)))
                if len(nums) >= 2 and nums[1] > screen_h * 0.70:
                    return nums[1]   # top edge of the bottom nav bar
        return int(screen_h * 0.92)  # generous fallback

    def long_press_ayah(self, cx: int, cy: int) -> bool:
        """Long-press at (cx, cy) and wait for the popup to appear."""
        self.d.long_click(cx, cy, duration=1.2)
        appeared = self.d(text=cfg.POPUP_CONCISE_TAB_TEXT).exists(
            timeout=cfg.POPUP_APPEAR_TIMEOUT
        )
        return appeared

    def close_popup(self) -> None:
        """Close the description bottom sheet by pressing Back."""
        self.d.press("back")
        # Wait for popup to finish closing (Concise tab should disappear)
        for _ in range(10):
            time.sleep(0.3)
            if not self.d(text=cfg.POPUP_CONCISE_TAB_TEXT).exists(timeout=0.5):
                break

    # ─── Page navigation ─────────────────────────────────────────────────────

    def swipe_next_quran_page(self) -> None:
        """Swipe to the next Quran page (right swipe = forward in RTL mushaf)."""
        info = self.d.info
        w = info["displayWidth"]
        h = info["displayHeight"]
        self.d.swipe(w * 0.15, h // 2, w * 0.85, h // 2, duration=0.4)
        time.sleep(cfg.PAGE_SWIPE_PAUSE)

    def swipe_prev_quran_page(self) -> None:
        """Swipe to the previous Quran page (left swipe = backward in RTL mushaf)."""
        info = self.d.info
        w = info["displayWidth"]
        h = info["displayHeight"]
        self.d.swipe(w * 0.85, h // 2, w * 0.15, h // 2, duration=0.4)
        time.sleep(cfg.PAGE_SWIPE_PAUSE)

    def _navigate_to_ayah_marker(self, target_ayah: int, surah: int, max_swipes: int = 50) -> tuple[int, int] | None:
        """
        Navigate the Quran reading view until target_ayah's marker is visible.

        Swipes forward if the current page is before the target, backward if
        we've overshot. Re-opens the surah after 25 failed swipes as a last resort.

        Returns (cx, cy) of the marker, or None if not found.
        """
        reopened = False
        for attempt in range(max_swipes):
            markers = self.find_verse_markers()

            if markers:
                hit = next((m for m in markers if m[0] == target_ayah), None)
                if hit:
                    return hit[1], hit[2]

                # Determine direction: if smallest visible marker > target we've overshot
                min_visible = min(m[0] for m in markers)
                if min_visible > target_ayah:
                    self.swipe_prev_quran_page()
                else:
                    self.swipe_next_quran_page()
            else:
                # No markers at all — swipe forward (might be a decoration/bismillah page)
                self.swipe_next_quran_page()

            # Mid-way fallback: re-open surah to reset position
            if attempt == 24 and not reopened:
                print(f"  [{surah}:{target_ayah}] ⚠ 25 swipes without finding marker — re-opening surah")
                self.navigate_to_surahs_tab()
                self.open_surah(surah)
                time.sleep(1.0)
                reopened = True

        return None

    # ─── Discover mode ───────────────────────────────────────────────────────

    def dump_hierarchy(self, output_path: str = "ui_hierarchy.xml") -> None:
        """Dump the current UI hierarchy to a file for inspection."""
        xml = self.d.dump_hierarchy(compressed=False)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(xml)
        screenshot_path = output_path.replace(".xml", ".png")
        self.d.screenshot(screenshot_path)
        print(f"[discover] Hierarchy → {output_path}")
        print(f"[discover] Screenshot → {screenshot_path}")
        print(
            "\nOpen the XML to find resource IDs for verse markers, then update config.py:\n"
            "  VERSE_MARKER_RESOURCE_ID = 'tv.bayyinah.quran:id/<id_here>'\n"
        )
        # Print package name for confirmation
        current_pkg = self.d.app_current().get("package", "unknown")
        print(f"[discover] Current app package: {current_pkg}")
        print(f"           Update APP_PACKAGE in config.py if different from '{cfg.APP_PACKAGE}'")

    # ─── Targeted refetch ────────────────────────────────────────────────────

    def run_refetch(
        self,
        refetch_list: list[tuple[int, int]],
        resume_after: tuple[int, int] | None = None,
    ) -> None:
        """
        Re-scrape a specific list of (surah, ayah) pairs in order.

        For each ayah, the existing DB record is deleted first so a fresh
        description is stored.  Progress is saved after every ayah so the
        run can be interrupted and resumed via resume_after=(surah, ayah).

        Args:
            refetch_list:   Sorted list of (surah, ayah) pairs to fetch.
            resume_after:   If given, skip all pairs up to and including
                            this (surah, ayah) before starting work.
        """
        from itertools import groupby

        # Optionally skip already-done entries
        pending = refetch_list
        if resume_after:
            rs, ra = resume_after
            pending = [(s, a) for s, a in refetch_list if (s > rs) or (s == rs and a > ra)]

        total = len(pending)
        done = 0
        print(f"[refetch] {total} ayahs to re-scrape")

        self.navigate_to_surahs_tab()

        # Track ranges already fully extracted in this run so we don't re-open
        # the popup for every individual ayah in a range.
        # Key: "{surah}:{range_str}"  e.g. "2:221-242"
        processed_ranges: dict[str, dict[int, str]] = {}

        # Group by surah so we open each surah only once
        for surah, group in groupby(pending, key=lambda x: x[0]):
            ayahs = [a for _, a in group]
            surah_name = db.get_surah_name(self.conn, surah)
            print(f"\n[refetch] ── Surah {surah}: {surah_name} ({len(ayahs)} ayahs to refetch) ──")

            self.open_surah(surah)
            time.sleep(1.0)

            for ayah in ayahs:
                # ── Check if this ayah belongs to an already-processed range ──
                row = self.conn.execute(
                    "SELECT description_range FROM ayah_descriptions WHERE surah=? AND ayah=?",
                    (surah, ayah),
                ).fetchone()
                existing_range = row[0] if row else None
                range_key = f"{surah}:{existing_range}" if existing_range else None

                if range_key and range_key in processed_ranges:
                    # Range was fully extracted earlier — save the section we
                    # already have and move on without opening a popup.
                    sections_cache = processed_ranges[range_key]
                    if ayah in sections_cache:
                        ayah_text = sections_cache[ayah]
                        db.upsert_description(self.conn, surah, ayah, ayah_text, existing_range)
                        done += 1
                        print(
                            f"  [{surah}:{ayah}] ↩ range {existing_range} "
                            f"(cached {len(ayah_text)} chars)  done={done}/{total}"
                        )
                        prog.save_refetch(surah, ayah)
                        continue
                    else:
                        # Extraction was incomplete — evict and re-extract fresh
                        del processed_ranges[range_key]
                        print(f"  [{surah}:{ayah}] cache miss — evicting and re-extracting")

                # ── Navigate to this ayah and open its popup ──────────────────
                target_coords = self._navigate_to_ayah_marker(ayah, surah)
                if target_coords is None:
                    print(f"  [{surah}:{ayah}] ⚠ marker not found after max swipes — skipping")
                    prog.save_refetch(surah, ayah)
                    done += 1
                    continue

                cx, cy = target_coords
                print(f"  [{surah}:{ayah}] Long-pressing…", end=" ", flush=True)

                popup_appeared = self.long_press_ayah(cx, cy)
                if not popup_appeared:
                    time.sleep(1.0)
                    popup_appeared = self.long_press_ayah(cx, cy)
                    if not popup_appeared:
                        print("⚠ popup never appeared — skipping")
                        prog.save_refetch(surah, ayah)
                        done += 1
                        continue

                # skip_scroll=True: popup stays at range start so extract_full_range()
                # can harvest from top → bottom without needing a scroll-to-top reset
                # (downward swipes to reset position dismiss the BottomSheet).
                content = extractor.extract(self.d, ayah, skip_scroll=True)

                if content is None:
                    self.close_popup()
                    print("⚠ extraction failed — skipping")
                    prog.save_refetch(surah, ayah)
                    done += 1
                    continue

                if content.range_str is not None:
                    # ── Range popup: scroll all the way to the bottom once ────
                    # Extract every ayah section in the range in a single pass.
                    # This avoids the per-ayah re-open + incomplete scroll cycle.
                    print(f"[range {content.range_str}] full-scroll extracting all sections…",
                          end=" ", flush=True)
                    all_sections = extractor.extract_full_range(
                        self.d, content.start_ayah, content.end_ayah
                    )
                    self.close_popup()

                    rk = f"{surah}:{content.range_str}"
                    processed_ranges[rk] = all_sections

                    # Save current ayah — it should be in all_sections (popup started
                    # at range start and scrolled to bottom).  The fallback uses
                    # content.raw_text (range-start text, not this ayah) only as a
                    # last resort; log a warning so incomplete extractions are visible.
                    if ayah in all_sections:
                        ayah_text = all_sections[ayah]
                    else:
                        ayah_text = content.raw_text
                        print(f"  ⚠ [{surah}:{ayah}] not harvested — using range-start fallback")
                    db.upsert_description(self.conn, surah, ayah, ayah_text, content.range_str)

                    done += 1
                    print(
                        f"✓ [{surah}:{ayah}] range={content.range_str} "
                        f"({len(ayah_text)} chars)  done={done}/{total} "
                        f"[{len(all_sections)} sections cached]"
                    )
                else:
                    # ── Single ayah: original path ────────────────────────────
                    self.close_popup()
                    sections = extractor.split_ayah_sections(
                        content.raw_text, content.start_ayah, content.end_ayah
                    )
                    ayah_text = sections.get(ayah, content.raw_text)
                    db.upsert_description(self.conn, surah, ayah, ayah_text, content.range_str)

                    done += 1
                    print(
                        f"✓ [{surah}:{ayah}] single "
                        f"({len(ayah_text)} chars)  done={done}/{total}"
                    )

                prog.save_refetch(surah, ayah)
                time.sleep(cfg.AYAH_PAUSE)

            print(f"[refetch] ✓ Surah {surah} done")
            self.d.press("back")
            time.sleep(cfg.BACK_PAUSE)
            self.navigate_to_surahs_tab()

        print(f"\n[refetch] ✅ Done! Re-scraped {done}/{total} ayahs.")
        self.conn.close()

    # ─── Main loop ───────────────────────────────────────────────────────────

    def run(self, start_surah: int = 1, start_ayah: int = 1) -> None:
        """
        Scrape all ayahs starting from (start_surah, start_ayah).
        Saves progress after every ayah — safe to Ctrl+C and resume.
        """
        total_scraped = db.scraped_count(self.conn)
        print(f"[scraper] Starting from Surah {start_surah}:{start_ayah}")

        self.navigate_to_surahs_tab()

        for surah in range(start_surah, 115):
            ayah_count = db.get_surah_ayah_count(self.conn, surah)
            surah_name = db.get_surah_name(self.conn, surah)
            print(f"\n[scraper] ── Surah {surah}: {surah_name} ({ayah_count} ayahs) ──")

            self.open_surah(surah)
            time.sleep(1.0)

            current_ayah = start_ayah if surah == start_surah else 1

            while current_ayah <= ayah_count:

                # Skip if already scraped
                if db.already_scraped(self.conn, surah, current_ayah):
                    print(f"  [{surah}:{current_ayah}] already in DB — skipping")
                    current_ayah += 1
                    continue

                # Find all visible verse markers and navigate to the target ayah
                target_coords = self._navigate_to_ayah_marker(current_ayah, surah)
                if target_coords is None:
                    print(f"  [{surah}:{current_ayah}] ⚠ Could not find marker after max swipes — skipping")
                    current_ayah += 1
                    continue

                cx, cy = target_coords
                print(f"  [{surah}:{current_ayah}] Long-pressing…", end=" ", flush=True)

                popup_appeared = self.long_press_ayah(cx, cy)
                if not popup_appeared:
                    print("popup didn't appear — retrying")
                    time.sleep(1.0)
                    popup_appeared = self.long_press_ayah(cx, cy)
                    if not popup_appeared:
                        print("⚠ Skipping (popup never appeared)")
                        current_ayah += 1
                        continue

                content = extractor.extract(self.d, current_ayah)
                self.close_popup()

                if content is None:
                    print("⚠ extraction failed — skipping")
                    current_ayah += 1
                    continue

                # Extract only the current ayah's slice.
                # Always attempt splitting by "Ayah N" headings — even when range_str
                # is None, the dump might contain adjacent ayah sections if they were
                # on-screen when the popup opened.
                sections = extractor.split_ayah_sections(
                    content.raw_text, content.start_ayah, content.end_ayah
                )
                ayah_text = sections.get(current_ayah, content.raw_text)

                db.upsert_description(
                    self.conn, surah, current_ayah, ayah_text, content.range_str
                )

                total_scraped += 1
                print(
                    f"✓ [{surah}:{current_ayah}] range={content.range_str or 'single'} "
                    f"({len(ayah_text)} chars)  total={total_scraped}"
                )

                prog.save(surah, current_ayah)
                current_ayah += 1  # always advance by 1 — never skip grouped ayahs
                time.sleep(cfg.AYAH_PAUSE)

            print(f"[scraper] ✓ Surah {surah} complete")
            # Back to surah list for next iteration
            self.d.press("back")
            time.sleep(cfg.BACK_PAUSE)
            self.navigate_to_surahs_tab()

        print(f"\n[scraper] ✅ All done! {db.scraped_count(self.conn)} ayahs in DB.")
        self.conn.close()


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _parse_num(text: str) -> int | None:
    """Extract an integer from text; handles Arabic-Indic numerals too."""
    if not text:
        return None
    # Normalise Arabic-Indic digits → ASCII
    arabic_indic = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
    normalised = text.strip().translate(arabic_indic)
    m = re.fullmatch(r"\d{1,3}", normalised)
    return int(m.group()) if m else None


def _attr(node_str: str, attr: str) -> str:
    m = re.search(rf'{attr}="([^"]*)"', node_str)
    return m.group(1) if m else ""


def _parse_bounds(bounds_str: str):
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds_str)
    return tuple(int(x) for x in m.groups()) if m else None
