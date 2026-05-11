import { getAyah, getSurah, isValidReference, getAyahsByReferences } from '@/lib/db';
import { queryCollection } from '@/lib/chroma';
import { generateVerseExplanation } from '@/lib/llm';
import { notFound } from 'next/navigation';
import Link from 'next/link';

interface Props {
  params: { chapter: string; verse: string };
}

export default async function VersePage({ params }: Props) {
  const chapter = parseInt(params.chapter, 10);
  const verse = parseInt(params.verse, 10);

  if (
    !Number.isInteger(chapter) ||
    !Number.isInteger(verse) ||
    chapter < 1 ||
    chapter > 114 ||
    verse < 1 ||
    !isValidReference(chapter, verse)
  ) {
    notFound();
  }

  const ayah = getAyah(chapter, verse);
  const surahRow = getSurah(chapter);
  if (!ayah || !surahRow) notFound();

  const chromaRows = await queryCollection(ayah.display_text, 7).catch(() => []);
  const relatedRefs = chromaRows
    .filter((r) => r.reference !== ayah.reference)
    .slice(0, 6)
    .map((r) => r.reference);
  const relatedAyahs = getAyahsByReferences(relatedRefs);
  const llm = await generateVerseExplanation(ayah, relatedAyahs);

  const relatedMap = new Map(relatedAyahs.map((a) => [a.reference, a]));

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-slate-400">
        <Link href="/" className="hover:text-emerald-400 transition-colors">
          Chat
        </Link>
        <span className="mx-2">›</span>
        <span>
          Surah {chapter} · Ayah {verse}
        </span>
      </nav>

      {/* Surah banner */}
      <div>
        <h1 className="text-2xl font-bold text-emerald-300">
          {surahRow.name_en}
        </h1>
        <p className="text-sm text-slate-400">
          Surah {chapter} · {surahRow.ayah_count} ayahs
        </p>
      </div>

      {/* Ayah card */}
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <span className="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-emerald-700 text-emerald-100 font-bold text-sm">
            {verse}
          </span>
          <p className="flex-1 text-lg leading-relaxed text-slate-100 font-medium">
            {ayah.display_text}
          </p>
        </div>
        <p className="text-xs text-slate-500">{ayah.reference} · The Clear Quran</p>
      </div>

      {/* Surah context */}
      {llm.surah_context && (
        <div className="bg-emerald-900/30 border border-emerald-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-1">
            Surah Context
          </p>
          <p className="text-sm text-slate-300 leading-relaxed">{llm.surah_context}</p>
        </div>
      )}

      {/* Explanation */}
      <div>
        <h2 className="text-base font-semibold text-slate-200 mb-2">Explanation</h2>
        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
          {llm.explanation}
        </p>
      </div>

      {/* Related ayahs */}
      {llm.related_references.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-slate-200 mb-3">Related Ayahs</h2>
          <div className="flex flex-col gap-2">
            {llm.related_references.map((ref) => {
              const a = relatedMap.get(ref);
              if (!a) return null;
              const [s, v] = ref.split(':');
              return (
                <Link
                  key={ref}
                  href={`/${s}/${v}`}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 hover:border-emerald-600 transition-colors"
                >
                  <span className="text-xs font-semibold text-emerald-400">{ref}</span>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">{a.display_text}</p>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Source policy */}
      <p className="text-xs text-slate-600 text-center">Source: The Clear Quran only</p>
    </div>
  );
}
