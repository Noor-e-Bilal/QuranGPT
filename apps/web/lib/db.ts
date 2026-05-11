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
  'no','so','we','i','you','he','she','they','our','your','my','his','her',
  'tell','us','me','quran','allah','god','islam','muslim',
]);

export function searchFTS(query: string, limit = 20): AyahRow[] {
  try {
    const tokens = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !FTS_STOP_WORDS.has(w));
    if (tokens.length === 0) return [];
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
