#!/usr/bin/env node
/**
 * Fetches Arabic text (text_uthmani) from Quran Foundation content API
 * and inserts it into the arabic_text column of quran_ayah in quran.db.
 *
 * Usage:
 *   QURAN_FOUNDATION_CLIENT_ID=... QURAN_FOUNDATION_CLIENT_SECRET=... node scripts/seed_arabic.js
 *
 * Or with .env.local values auto-loaded:
 *   node -r dotenv/config scripts/seed_arabic.js dotenv_config_path=apps/web/.env.local
 *
 * Requires: node 22+ (for node:sqlite), fetch (node 18+)
 */

'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../data/quran.db');
const TOKEN_URL = 'https://prelive-oauth2.quran.foundation/oauth2/token';
const CONTENT_API = 'https://content-api.quran.foundation';
const CLIENT_ID = process.env.QURAN_FOUNDATION_CLIENT_ID;
const CLIENT_SECRET = process.env.QURAN_FOUNDATION_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: QURAN_FOUNDATION_CLIENT_ID and QURAN_FOUNDATION_CLIENT_SECRET must be set');
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`Error: DB not found at ${DB_PATH}`);
  process.exit(1);
}

async function getToken() {
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=content',
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
}

async function fetchChapter(chapterId, token) {
  const url = `${CONTENT_API}/api/v4/verses/by_chapter/${chapterId}?words=false&fields=text_uthmani&per_page=300`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Chapter ${chapterId} fetch failed: ${res.status}`);
  const data = await res.json();
  return data.verses;
}

async function main() {
  const db = new DatabaseSync(DB_PATH);

  // Add arabic_text column if not exists
  const cols = db.prepare("PRAGMA table_info(quran_ayah)").all();
  const hasCol = cols.some((c) => c.name === 'arabic_text');
  if (!hasCol) {
    console.log('Adding arabic_text column...');
    db.prepare("ALTER TABLE quran_ayah ADD COLUMN arabic_text TEXT NOT NULL DEFAULT ''").run();
  } else {
    console.log('Column arabic_text already exists — updating values...');
  }

  const update = db.prepare('UPDATE quran_ayah SET arabic_text = ? WHERE surah = ? AND ayah = ?');

  let auth = await getToken();
  console.log(`Token acquired, expires in ~${Math.round((auth.expiresAt - Date.now()) / 60000)} min`);

  let totalInserted = 0;

  for (let surah = 1; surah <= 114; surah++) {
    // Refresh token if within 60s of expiry
    if (Date.now() >= auth.expiresAt) {
      console.log('Refreshing token...');
      auth = await getToken();
    }

    const verses = await fetchChapter(surah, auth.token);
    // node:sqlite uses exec for batching; just iterate
    for (const v of verses) {
      update.run(v.text_uthmani, surah, v.verse_number);
    }
    totalInserted += verses.length;

    process.stdout.write(`\rSurah ${surah}/114 — ${totalInserted} verses done`);

    // Polite rate limiting: 50ms between chapters
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`\n\nDone. ${totalInserted} Arabic texts inserted into quran.db`);

  // Verify
  const sample = db.prepare("SELECT surah, ayah, arabic_text FROM quran_ayah WHERE surah = 1 AND ayah = 1").get();
  console.log('Verification (1:1):', sample);

  const missing = db.prepare("SELECT COUNT(*) as n FROM quran_ayah WHERE arabic_text = '' OR arabic_text IS NULL").get();
  if (missing.n > 0) {
    console.warn(`WARNING: ${missing.n} rows still have empty arabic_text`);
    process.exit(1);
  }
  console.log('✓ All rows have arabic_text');
  db.close();
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
