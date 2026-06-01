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
        "An-Nahl", "Al-Isra", "Al-Kahf", "Maryam", "Ta-Ha",
        "Al-Anbiya", "Al-Hajj", "Al-Mu'minun", "An-Nur", "Al-Furqan",
        "Ash-Shu'ara", "An-Naml", "Al-Qasas", "Al-'Ankabut", "Ar-Rum",
        "Luqman", "As-Sajdah", "Al-Ahzab", "Saba", "Fatir",
        "Ya-Sin", "As-Saffat", "Sad", "Az-Zumar", "Ghafir",
        "Fussilat", "Ash-Shura", "Az-Zukhruf", "Ad-Dukhan", "Al-Jathiyah",
        "Al-Ahqaf", "Muhammad", "Al-Fath", "Al-Hujurat", "Qaf",
        "Adh-Dhariyat", "At-Tur", "An-Najm", "Al-Qamar", "Ar-Rahman",
        "Al-Waqi'ah", "Al-Hadid", "Al-Mujadila", "Al-Hashr", "Al-Mumtahanah",
        "As-Saf", "Al-Jumu'ah", "Al-Munafiqun", "At-Taghabun", "At-Talaq",
        "At-Tahrim", "Al-Mulk", "Al-Qalam", "Al-Haqqah", "Al-Ma'arij",
        "Nuh", "Al-Jinn", "Al-Muzzammil", "Al-Muddaththir", "Al-Qiyamah",
        "Al-Insan", "Al-Mursalat", "An-Naba", "An-Nazi'at", "'Abasa",
        "At-Takwir", "Al-Infitar", "Al-Mutaffifin", "Al-Inshiqaq", "Al-Buruj",
        "At-Tariq", "Al-A'la", "Al-Ghashiyah", "Al-Fajr", "Al-Balad",
        "Ash-Shams", "Al-Layl", "Ad-Duha", "Ash-Sharh", "At-Tin",
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
        """Tap the Surahs tab in the bottom nav bar."""
        tab = self.d(text=cfg.SURAHS_TAB_TEXT)
        if tab.exists(timeout=5):
            tab.click()
            time.sleep(0.8)
        else:
            raise RuntimeError(
                f"Could not find '{cfg.SURAHS_TAB_TEXT}' tab. "
                "Run --discover to inspect the UI hierarchy."
            )

    def open_surah(self, surah_number: int) -> None:
        """
        Navigate to a specific surah.
        Uses the search box for reliability — avoids infinite scroll through 114 items.
        """
        name = self.SURAH_ENGLISH_NAMES[surah_number - 1]
        print(f"[scraper] Opening Surah {surah_number}: {name}")

        # Use the search box
        search = self.d(text=cfg.SURAH_SEARCH_HINT)
        if not search.exists(timeout=5):
            # May already be on the list; try scrolling to top first
            self.d.press("back")
            time.sleep(cfg.BACK_PAUSE)
            self.navigate_to_surahs_tab()
            search = self.d(text=cfg.SURAH_SEARCH_HINT)

        search.click()
        time.sleep(0.4)
        self.d.clear_text()
        self.d.send_keys(name)
        time.sleep(0.8)

        # Tap the first matching result
        result = self.d(textContains=name)
        if not result.exists(timeout=5):
            raise RuntimeError(f"Surah '{name}' not found in search results")
        result.click()
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
        short number string (likely verse number circles).
        """
        results = []
        try:
            hierarchy = self.d.dump_hierarchy(compressed=False)
            for node in hierarchy.split("<node"):
                text = _attr(node, "text")
                if not text:
                    continue
                n = _parse_num(text)
                if n is None:
                    continue
                bounds_str = _attr(node, "bounds")
                b = _parse_bounds(bounds_str)
                if b is None:
                    continue
                w = b[2] - b[0]
                h = b[3] - b[1]
                # Verse number circles are small (< 80px wide)
                if 5 < w < 80 and 5 < h < 80:
                    cx = (b[0] + b[2]) // 2
                    cy = (b[1] + b[3]) // 2
                    results.append((n, cx, cy))
        except Exception as e:
            print(f"[scraper] Warning: autodetect failed — {e}")
        return results

    def long_press_ayah(self, cx: int, cy: int) -> bool:
        """Long-press at (cx, cy) and wait for the popup to appear."""
        self.d.long_click(cx, cy, duration=1.2)
        appeared = self.d(text=cfg.POPUP_CONCISE_TAB_TEXT).exists(
            timeout=cfg.POPUP_APPEAR_TIMEOUT
        )
        return appeared

    def close_popup(self) -> None:
        """Close the description bottom sheet."""
        # Try close button by content description first
        close = self.d(description=cfg.POPUP_CLOSE_BUTTON_DESC)
        if close.exists(timeout=2):
            close.click()
        elif cfg.POPUP_CLOSE_BUTTON_TEXT:
            self.d(text=cfg.POPUP_CLOSE_BUTTON_TEXT).click()
        else:
            # Fallback: press back
            self.d.press("back")
        time.sleep(0.5)

    # ─── Page navigation ─────────────────────────────────────────────────────

    def swipe_next_quran_page(self) -> None:
        """
        Swipe right to advance to the next Quran page (mushaf style).
        In RTL mushaf, swiping right = forward (next page).
        """
        info = self.d.info
        w = info["displayWidth"]
        h = info["displayHeight"]
        mid_y = h // 2
        # Swipe from left edge to right edge
        self.d.swipe(w * 0.15, mid_y, w * 0.85, mid_y, duration=0.4)
        time.sleep(cfg.PAGE_SWIPE_PAUSE)

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

                # Find all visible verse markers
                markers = self.find_verse_markers()
                if not markers:
                    print(f"  [{surah}:{current_ayah}] No markers found on screen — trying swipe")
                    self.swipe_next_quran_page()
                    markers = self.find_verse_markers()

                if not markers:
                    print(f"  [{surah}:{current_ayah}] ⚠ Still no markers — dumping hierarchy for inspection")
                    self.dump_hierarchy(f"debug_{surah}_{current_ayah}.xml")
                    raise RuntimeError(
                        f"Cannot find verse markers at Surah {surah}:{current_ayah}. "
                        "Check debug_*.xml and update VERSE_MARKER_RESOURCE_ID in config.py."
                    )

                # Find the marker for current_ayah
                target = next((m for m in markers if m[0] == current_ayah), None)
                if target is None:
                    # Ayah not visible on this page — swipe to next
                    self.swipe_next_quran_page()
                    continue

                ayah_num, cx, cy = target
                print(f"  [{surah}:{ayah_num}] Long-pressing…", end=" ", flush=True)

                popup_appeared = self.long_press_ayah(cx, cy)
                if not popup_appeared:
                    print("popup didn't appear — retrying")
                    time.sleep(1.0)
                    popup_appeared = self.long_press_ayah(cx, cy)
                    if not popup_appeared:
                        print("⚠ Skipping (popup never appeared)")
                        current_ayah += 1
                        continue

                content = extractor.extract(self.d, ayah_num)
                self.close_popup()

                if content is None:
                    print("⚠ extraction failed — skipping")
                    current_ayah += 1
                    continue

                # Store one row per ayah covered by this popup
                for a in range(content.start_ayah, content.end_ayah + 1):
                    if a <= ayah_count:
                        db.upsert_description(
                            self.conn, surah, a, content.raw_text, content.range_str
                        )

                total_scraped += (content.end_ayah - content.start_ayah + 1)
                print(
                    f"✓ range={content.range_str or str(ayah_num)} "
                    f"({len(content.raw_text)} chars)  total={total_scraped}"
                )

                prog.save(surah, content.end_ayah)
                current_ayah = content.end_ayah + 1
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
