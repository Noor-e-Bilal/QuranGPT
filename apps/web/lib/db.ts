import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import type { AyahRow, SurahRow } from './types';

const DB_PATH =
  process.env.DB_PATH ?? path.join(process.cwd(), '../../data/quran.db');

let _db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH, { readOnly: true });
  }
  return _db;
}

function toPlain<T>(row: unknown): T | null {
  if (!row) return null;
  return Object.assign({}, row) as T;
}

function toPlainArray<T>(rows: unknown[]): T[] {
  return rows.map((r) => Object.assign({}, r) as T);
}

export function getAyah(chapter: number, verse: number): AyahRow | null {
  const row = getDb()
    .prepare('SELECT * FROM quran_ayah WHERE surah = ? AND ayah = ?')
    .get(chapter, verse);
  return toPlain<AyahRow>(row);
}

export function getSurah(chapter: number): SurahRow | null {
  const row = getDb()
    .prepare('SELECT * FROM quran_surah WHERE surah = ?')
    .get(chapter);
  return toPlain<SurahRow>(row);
}

export function isValidReference(chapter: number, verse: number): boolean {
  const surah = getSurah(chapter);
  if (!surah) return false;
  return verse >= 1 && verse <= surah.ayah_count;
}

const FTS_STOP_WORDS = new Set([
  'the','a','an','is','it','in','of','to','and','or','for','about','what',
  'does','say','how','why','who','when','where','which','do','did','can',
  'will','should','would','could','has','have','had','be','been','are',
  'was','were','this','that','with','from','by','at','as','if','but','not',
  'no','so','we','i','you','you','he','she','they','our','your','my','his','her',
  'tell','us','me','quran','allah','god','islam','muslim',
  // classifier / question words that match noise
  'type','types','kind','kinds','form','forms','sort','sorts',
  'concept','meaning','definition','example','examples','explain',
  'describe','description','list','mention','mentioned','according','different',
  // quantity / count noise words
  'much','many','time','times','number','total','often','count','how many',
  'more','less','few','several','some','any','all','every','each',
]);

/**
 * Maps Arabic Islamic terms to their English equivalents as used in
 * The Clear Quran translation. This bridges the gap where users ask
 * about "jihad", "salah", etc. but the text uses English equivalents.
 */
const ISLAMIC_SYNONYMS: Record<string, string[]> = {
  jihad:      ['strive','striving','struggle','fight','fighting','cause'],
  mujahid:    ['strive','struggle','fighter','cause'],
  salah:      ['prayer','pray','worship','establish','morning','evening','noon','decline','sunset','dawn','dusk','midday'],
  salat:      ['prayer','pray','worship','establish','morning','evening','noon','decline','sunset','dawn','dusk','midday'],
  zakat:      ['alms','charity','spend','donate','give'],
  sawm:       ['fast','fasting','abstain'],
  siyam:      ['fast','fasting'],
  hajj:       ['pilgrimage','pilgrims'],
  umrah:      ['pilgrimage','visit'],
  iman:       ['faith','believe','belief','trust'],
  taqwa:      ['righteous','piety','fear','conscious'],
  shaytan:    ['satan','devil','evil'],
  shaitan:    ['satan','devil','evil'],
  iblis:      ['satan','devil','enemy'],
  jannah:     ['paradise','garden','heaven'],
  jahannam:   ['hell','fire','torment'],
  rasul:      ['prophet','messenger','apostle'],
  nabi:       ['prophet','messenger'],
  ummah:      ['community','nation','people'],
  dua:        ['pray','supplication','call'],
  tawhid:     ['oneness','unity','one'],
  shirk:      ['polytheism','partners','idolatry','idol'],
  kufr:       ['disbelief','disbelievers','reject','deny'],
  kafir:      ['disbeliever','disbelievers','reject'],
  munafiq:    ['hypocrite','hypocrites','hypocrisy'],
  nifaq:      ['hypocrisy','hypocrite'],
  riba:       ['usury','interest','consume'],
  ribaa:      ['usury','interest','consume'],
  halal:      ['lawful','permissible','allowed'],
  haram:      ['forbidden','unlawful','prohibited'],
  sabr:       ['patience','patient','persevere','endure'],
  shukr:      ['gratitude','thankful','grateful'],
  tawbah:     ['repent','repentance','forgive','forgiveness','return'],
  tawba:      ['repent','repentance','forgive','forgiveness'],
  qadr:       ['destiny','decree','fate','predestination'],
  akhirah:    ['afterlife','hereafter','resurrection','judgment'],
  aakhirah:   ['afterlife','hereafter','resurrection'],
  sirat:      ['path','way','straight'],
  malaika:    ['angel','angels'],
  malak:      ['angel','angels'],
  kitab:      ['scripture','book','revelation'],
  sunnah:     ['practice','custom','example','tradition'],
  dawah:      ['call','invite','spread','preach'],
  hikmah:     ['wisdom','wise','knowledge'],
  ilm:        ['knowledge','learn','wisdom'],
  amal:       ['deed','action','work'],
  amanah:     ['trust','honest','fulfil','trustworthy'],
  sidq:       ['truth','truthful','honest'],
  tawakkul:   ['trust','reliance','rely'],
  rizq:       ['sustenance','provision','provide'],
  barakah:    ['blessing','bless','grace'],
  noor:       ['light','guidance','illuminate'],
  nur:        ['light','guidance','illuminate'],
  hidayah:    ['guidance','guide','path'],
  khilafah:   ['vicegerent','successor','stewardship'],
  khalifah:   ['vicegerent','successor','steward'],
  adl:        ['justice','just','fair','equity'],
  zulm:       ['injustice','wrong','oppression','wrongdoer'],
  ihsan:      ['goodness','excellence','good','righteous'],
  fasad:      ['corruption','mischief','corrupt'],
  fitnah:     ['trial','test','temptation','persecution','discord'],
  ghayb:      ['unseen','hidden','unknown'],
  rahma:      ['mercy','compassion','merciful'],
  rahmah:     ['mercy','compassion','merciful'],
};

/** Expand query for ChromaDB: replaces Arabic Islamic terms with English synonyms. */
export function expandQueryForSemantic(query: string): string {
  const raw = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (raw.length === 0) return query;
  const expanded: string[] = [];
  for (const token of raw) {
    const synonyms = ISLAMIC_SYNONYMS[token];
    if (synonyms) {
      expanded.push(...synonyms);
    } else {
      expanded.push(token);
    }
  }
  return [...new Set(expanded)].join(' ');
}

function expandTokens(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    const synonyms = ISLAMIC_SYNONYMS[token];
    if (synonyms) {
      expanded.push(...synonyms);
    } else {
      expanded.push(token);
    }
  }
  return [...new Set(expanded)];
}

export function searchFTS(query: string, limit = 20): AyahRow[] {
  try {
    const raw = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !FTS_STOP_WORDS.has(w));
    if (raw.length === 0) return [];
    const tokens = expandTokens(raw);
    const ftsQuery = tokens.join(' OR ');
    const rows = getDb()
      .prepare(
        `SELECT a.surah, a.ayah, a.reference, a.text, a.display_text, a.tokens_count
         FROM quran_fts f
         JOIN quran_ayah a ON f.reference = a.reference
         WHERE quran_fts MATCH ?
         ORDER BY f.rank
         LIMIT ?`
      )
      .all(ftsQuery, limit);
    return toPlainArray<AyahRow>(rows);
  } catch {
    return [];
  }
}

export function getAyahsByReferences(references: string[]): AyahRow[] {
  if (references.length === 0) return [];
  const placeholders = references.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT * FROM quran_ayah WHERE reference IN (${placeholders})`)
    .all(...references);
  return toPlainArray<AyahRow>(rows);
}

export function checkDbHealth(): boolean {
  try {
    getDb().prepare('SELECT 1 FROM quran_ayah LIMIT 1').get();
    return true;
  } catch {
    return false;
  }
}
