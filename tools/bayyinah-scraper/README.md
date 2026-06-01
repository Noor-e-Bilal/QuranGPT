# Bayyinah Scraper

Python ADB automation that extracts the **Concise** tafseer description for every one of the 6,236 ayahs from the Bayyinah app and stores them in `data/quran-with-tafsir.db`.

---

## Prerequisites

| Requirement | How to get it |
|---|---|
| Python 3.11+ | `brew install python` |
| ADB | `brew install --cask android-platform-tools` |
| Bayyinah app | Installed on an Android device |
| USB Debugging | Enabled in device Developer Options |

---

## First-time setup

```bash
cd tools/bayyinah-scraper
pip install -r requirements.txt

# Install the uiautomator2 server APK on the device
python -m uiautomator2 init
```

---

## Confirm the app package name

```bash
# Connect device via USB, then:
adb devices                                            # confirm device is listed
adb shell pm list packages | grep -i bayyinah         # find the package name
```

Update `APP_PACKAGE` in `config.py` if it differs from `tv.bayyinah.quran`.

---

## Discover mode (required before first run)

Open the Bayyinah app, navigate to a Quran page, long-press an ayah so the popup is visible, then run:

```bash
python run.py --discover
# Press Enter when prompted
```

This saves `ui_hierarchy.xml` and `ui_hierarchy.png`.

Open `ui_hierarchy.xml` and search for the verse-number circle elements.
Find the `resource-id` attribute and update `config.py`:

```python
VERSE_MARKER_RESOURCE_ID = "tv.bayyinah.quran:id/<id_you_found>"
```

If the popup close button has a different description, update `POPUP_CLOSE_BUTTON_DESC` too.

---

## Running the scraper

```bash
# Check progress
python run.py --status

# Start from beginning (or auto-resume if progress.json exists)
python run.py

# Force resume
python run.py --resume

# Start at a specific verse
python run.py --surah 2 --ayah 1

# Reset progress (start over)
python run.py --reset

# Specify device serial (if multiple devices connected)
python run.py --device emulator-5554
```

---

## How grouped ayahs work

Some ayahs share a single Concise description (e.g., Al-Baqarah Ayahs 1–3).
When the scraper detects this:

- It stores the **same description text** in rows for ayah 1, 2, and 3
- Sets `description_range = "1-3"` on each row as metadata
- Advances to ayah 4 (no redundant long-presses)

This ensures every QuranSays verse page (`/2/1`, `/2/2`, `/2/3`) has content.

---

## Output

`data/quran-with-tafsir.db` — a copy of `quran.db` with an additional table:

```sql
CREATE TABLE ayah_descriptions (
    surah             INTEGER NOT NULL,
    ayah              INTEGER NOT NULL,
    description       TEXT    NOT NULL,
    description_range TEXT,          -- "1-3" if grouped, NULL if individual
    scraped_at        DATETIME,
    PRIMARY KEY (surah, ayah)
);
```

`quran.db` is **never modified**.

---

## Resuming after interruption

The scraper saves progress to `progress.json` after every ayah. If it crashes or is interrupted, just run `python run.py --resume` (or plain `python run.py`) and it picks up from the next unscraped ayah.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `No markers found on screen` | Run `--discover` on the Quran reader page, find the verse number resource ID, update `config.py` |
| `Could not find 'Surahs' tab` | The tab text may differ — run `--discover` on the app home screen and check `SURAHS_TAB_TEXT` in `config.py` |
| Popup doesn't appear | Increase `POPUP_APPEAR_TIMEOUT` in `config.py`; ensure ADB is stable |
| Wrong app package | Run `adb shell pm list packages \| grep -i bayyinah` and update `APP_PACKAGE` |
