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

export function searchFTS(query: string, limit = 20): AyahRow[] {
  try {
    const safe = query.replace(/[^\w\s]/g, ' ').trim();
    if (!safe) return [];
    const rows = getDb()
      .prepare(
        `SELECT a.surah, a.ayah, a.reference, a.text, a.display_text, a.tokens_count
         FROM quran_fts f
         JOIN quran_ayah a ON f.reference = a.reference
         WHERE quran_fts MATCH ?
         ORDER BY f.rank
         LIMIT ?`
      )
      .all(safe, limit);
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
