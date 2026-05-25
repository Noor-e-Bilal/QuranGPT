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
  // ── English topic expansions ─────────────────────────────────────────────
  // Users ask in English; these map common concepts to Quran vocabulary.
  honesty:    ['honest','truthful','sincere','trustworthy','truth'],
  lying:      ['false','falsehood','lie','deceit','deceive','dishonest'],
  lie:        ['false','falsehood','deceit','deceive','dishonest'],
  patience:   ['patient','persevere','endure','steadfast','steadfastness'],
  grateful:   ['gratitude','thankful','grateful','shukr','appreciate'],
  gratitude:  ['thankful','grateful','appreciate','bless'],
  kindness:   ['kind','gentle','compassion','merciful','goodness'],
  arrogance:  ['arrogant','proud','haughty','boast','vain','pride'],
  humility:   ['humble','modest','meek','lowly','modest'],
  greed:      ['greedy','hoard','miser','excess','accumulate','wealth'],
  wealth:     ['money','riches','property','treasure','possessions','spend','charity'],
  poverty:    ['poor','needy','destitute','indigent','alms'],
  marriage:   ['marry','married','husband','wife','spouse','wed','wedlock'],
  divorce:    ['divorce','talaq','separate','separation'],
  parents:    ['mother','father','parent','parents','obey'],
  children:   ['children','child','son','daughter','offspring'],
  death:      ['dead','die','dying','mortal','mortality','hereafter'],
  friendship: ['friend','companion','associate','company'],
  jealousy:   ['envy','jealous','covet','grudge'],
  anger:      ['angry','anger','rage','wrath','furious'],
  love:       ['love','affection','compassion','kind'],
  fear:       ['afraid','fear','terror','dread','awe'],
  hope:       ['hope','hopeful','optimism','expect'],
  forgiveness:['forgive','pardon','absolve','mercy','repent'],
  charity:    ['spend','give','donate','alms','charity','poor'],
  knowledge:  ['know','knowing','wisdom','learn','understand','educated'],
  justice:    ['just','fair','equity','right','wrong','oppress'],
  oppression: ['oppress','wrong','injustice','tyrant','unjust'],
  war:        ['war','battle','fight','enemy','peace','truce'],
  peace:      ['peace','security','tranquil','reconcile','truce'],
  food:       ['eat','drink','consume','lawful','forbidden','flesh'],
  business:   ['trade','commerce','transaction','contract','deal','market'],
  prayer:     ['pray','prayer','worship','prostrate','bow','stand'],
  fasting:    ['fast','fasting','abstain','ramadan','month'],
  sins:       ['sin','sins','transgress','wrong','evil','bad','immoral'],
  sin:        ['sin','transgress','wrong','evil','bad','immoral'],
  reward:     ['reward','recompense','paradise','jannah','good deed'],
  punishment: ['punishment','torment','hell','fire','wrath','consequence'],
  belief:     ['believe','faith','trust','conviction','iman'],
  disbelief:  ['disbelieve','reject','deny','kafir','infidel'],
  hypocrite:  ['hypocrite','hypocrisy','double','deceit','munafiq'],
  worship:    ['worship','pray','prostrate','serve','obey','devote'],
};

/**
 * Maps English Islamic concepts to their Arabic/Latin transliterations.
 * Used in reverse-direction query expansion so that "honesty" also searches
 * for "sidq amana" and vice versa.
 */
const ENGLISH_TO_ARABIC: Record<string, string[]> = {
  honesty:      ['sidq','amana','amanah','sadiq'],
  honest:       ['sidq','amana','amanah'],
  truthfulness: ['sidq','sadiq'],
  truthful:     ['sidq','sadiq'],
  truth:        ['sidq','haqq'],
  trust:        ['amana','amanah','tawakkul'],
  trustworthy:  ['amana','amanah'],
  patience:     ['sabr'],
  patient:      ['sabr'],
  perseverance: ['sabr'],
  gratitude:    ['shukr'],
  grateful:     ['shukr'],
  thankful:     ['shukr'],
  repentance:   ['tawbah','tawba'],
  repent:       ['tawbah','tawba'],
  forgiveness:  ['tawbah','afw'],
  faith:        ['iman'],
  belief:       ['iman'],
  believe:      ['iman'],
  piety:        ['taqwa'],
  righteous:    ['taqwa','ihsan'],
  righteousness:['taqwa','ihsan'],
  prayer:       ['salah','salat','dua'],
  pray:         ['salah','salat','dua'],
  supplication: ['dua'],
  charity:      ['zakat','sadaqah'],
  alms:         ['zakat','sadaqah'],
  fasting:      ['sawm','siyam'],
  fast:         ['sawm','siyam'],
  pilgrimage:   ['hajj','umrah'],
  mercy:        ['rahma','rahmah'],
  compassion:   ['rahma','rahmah'],
  justice:      ['adl'],
  just:         ['adl'],
  fairness:     ['adl'],
  wisdom:       ['hikmah','ilm'],
  wise:         ['hikmah'],
  knowledge:    ['ilm','hikmah'],
  guidance:     ['hidayah','noor','nur'],
  light:        ['noor','nur'],
  goodness:     ['ihsan'],
  excellence:   ['ihsan'],
  corruption:   ['fasad'],
  trial:        ['fitnah'],
  temptation:   ['fitnah'],
  disbelief:    ['kufr','kafir'],
  hypocrisy:    ['nifaq','munafiq'],
  hypocrite:    ['munafiq','nifaq'],
  usury:        ['riba','ribaa'],
  interest:     ['riba'],
  blessing:     ['barakah'],
  provision:    ['rizq'],
  sustenance:   ['rizq'],
  paradise:     ['jannah'],
  heaven:       ['jannah'],
  hell:         ['jahannam'],
  satan:        ['shaytan','iblis'],
  devil:        ['shaytan','iblis'],
  oneness:      ['tawhid'],
  monotheism:   ['tawhid'],
  polytheism:   ['shirk'],
  idolatry:     ['shirk'],
  oppression:   ['zulm'],
  injustice:    ['zulm'],
  reliance:     ['tawakkul'],
};

/** Words that add no retrieval value to a reformulated query. */
const REFORMULATION_NOISE = new Set([
  'islam','islamic','quran','quran','muslim','muslims','allah',
  'mention','mentions','mentioned','say','says','said','teach',
  'teaches','taught','discuss','discusses','described','describes',
  'describe','tell','tells','told','speak','speaks','spoke',
  'what','how','does','did','do','is','are','was','were',
  'about','regarding','according','per','for','the','a','an',
  'of','in','on','at','to','with','by','from','and','or',
  'al','ibn', // Arabic particles
]);

/**
 * Enriches a reformulated keyword string by:
 * 1. Removing meta/noise words (islam, quran, mention, say, etc.)
 * 2. Adding English synonyms from ISLAMIC_SYNONYMS
 * 3. Adding Arabic/Latin transliterations from ENGLISH_TO_ARABIC
 *
 * Keeps total length reasonable (≤ 60 chars) by limiting synonym depth.
 */
export function expandReformulation(keywords: string): string {
  const tokens = keywords
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !REFORMULATION_NOISE.has(t));

  if (tokens.length === 0) return keywords; // all noise — return unchanged

  const expanded = new Set<string>(tokens);

  for (const token of tokens) {
    // Forward: English concept → Arabic transliterations
    const arabic = ENGLISH_TO_ARABIC[token];
    if (arabic) arabic.forEach((a) => expanded.add(a));

    // Reverse: Arabic term → English synonyms (already in ISLAMIC_SYNONYMS)
    const synonyms = ISLAMIC_SYNONYMS[token];
    if (synonyms) synonyms.slice(0, 3).forEach((s) => expanded.add(s));
  }

  // Cap at 20 tokens to prevent runaway query length / cache-key fragmentation
  const MAX_TOKENS = 20;
  const out = [...expanded];
  return (out.length > MAX_TOKENS ? out.slice(0, MAX_TOKENS) : out).join(' ');
}

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

export function getAllSurahs(): SurahRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM quran_surah ORDER BY surah')
    .all();
  return toPlainArray<SurahRow>(rows);
}

export function getAyahsBySurah(chapter: number): AyahRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM quran_ayah WHERE surah = ? ORDER BY ayah')
    .all(chapter);
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
