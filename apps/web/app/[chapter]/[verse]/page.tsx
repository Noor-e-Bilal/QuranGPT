import { getAyah, getSurah, getAllSurahs } from '@/lib/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import AyahFrame from '@/app/components/AyahFrame';

interface Props {
  params: Promise<{ chapter: string; verse: string }>;
}

export async function generateStaticParams() {
  const surahs = getAllSurahs();
  const params: { chapter: string; verse: string }[] = [];
  for (const s of surahs) {
    for (let v = 1; v <= s.ayah_count; v++) {
      params.push({ chapter: String(s.surah), verse: String(v) });
    }
  }
  return params;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chapter, verse } = await params;
  const ch = parseInt(chapter, 10);
  const vs = parseInt(verse, 10);
  const ayah = getAyah(ch, vs);
  const surahRow = getSurah(ch);
  if (!ayah || !surahRow) return {};

  const title = `Surah ${surahRow.name_en} ${ch}:${vs} — QuranSays`;
  const description = ayah.display_text.slice(0, 160);
  const url = `https://quransays.com/${ch}/${vs}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: 'QuranSays',
      type: 'article',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
    alternates: { canonical: url },
  };
}

export default async function VersePage({ params }: Props) {
  const { chapter, verse } = await params;
  const ch = parseInt(chapter, 10);
  const vs = parseInt(verse, 10);

  if (!Number.isInteger(ch) || !Number.isInteger(vs) || ch < 1 || ch > 114 || vs < 1) {
    notFound();
  }

  const ayah = getAyah(ch, vs);
  const surahRow = getSurah(ch);
  if (!ayah || !surahRow) notFound();

  const prevVerse = vs > 1 ? vs - 1 : null;
  const nextVerse = vs < surahRow.ayah_count ? vs + 1 : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://quransays.com' },
          {
            '@type': 'ListItem',
            position: 2,
            name: `Surah ${surahRow.name_en}`,
            item: `https://quransays.com/${ch}`,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: `Ayah ${vs}`,
            item: `https://quransays.com/${ch}/${vs}`,
          },
        ],
      },
      {
        '@type': 'Article',
        headline: `Surah ${surahRow.name_en} ${ch}:${vs}`,
        description: ayah.display_text.slice(0, 200),
        isPartOf: { '@type': 'Book', name: 'The Clear Quran', author: 'Mustafa Khattab' },
        url: `https://quransays.com/${ch}/${vs}`,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-8">
        {/* Breadcrumb */}
        <nav className="text-sm text-slate-400 flex items-center gap-1">
          <Link href="/" className="hover:text-emerald-400 transition-colors">
            Home
          </Link>
          <span className="mx-1">›</span>
          <Link href={`/${ch}`} className="hover:text-emerald-400 transition-colors">
            {surahRow.name_en}
          </Link>
          <span className="mx-1">›</span>
          <span>Ayah {vs}</span>
        </nav>

        {/* Surah title */}
        <div>
          <h1 className="text-2xl font-bold text-emerald-300">
            Surah {surahRow.name_en}
          </h1>
          <p className="text-sm text-slate-400">
            {ch}:{vs} · {surahRow.ayah_count} ayahs
          </p>
        </div>

        {/* Arabic frame */}
        {ayah.arabic_text && (
          <AyahFrame arabic={ayah.arabic_text} surah={ch} ayah={vs} />
        )}

        {/* English translation */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6">
          <p className="text-base sm:text-lg leading-relaxed text-slate-100">
            {ayah.display_text}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            {ayah.reference} · The Clear Quran (Mustafa Khattab)
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex items-center justify-between gap-4">
          {prevVerse ? (
            <Link
              href={`/${ch}/${prevVerse}`}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:border-emerald-600 text-sm text-slate-300 transition-colors"
            >
              ← Ayah {prevVerse}
            </Link>
          ) : (
            <span />
          )}
          <Link
            href={`/${ch}`}
            className="text-xs text-slate-400 hover:text-emerald-400 transition-colors"
          >
            All ayahs ↑
          </Link>
          {nextVerse ? (
            <Link
              href={`/${ch}/${nextVerse}`}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:border-emerald-600 text-sm text-slate-300 transition-colors"
            >
              Ayah {nextVerse} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </>
  );
}
