import { getSurah, getAyahsBySurah, getAllSurahs } from '@/lib/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';

interface Props {
  params: Promise<{ chapter: string }>;
}

export async function generateStaticParams() {
  return Array.from({ length: 114 }, (_, i) => ({ chapter: String(i + 1) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chapter } = await params;
  const ch = parseInt(chapter, 10);
  const surahRow = getSurah(ch);
  if (!surahRow) return {};

  const title = `Surah ${surahRow.name_en} (${ch}) — QuranSays`;
  const description = `Read all ${surahRow.ayah_count} ayahs of Surah ${surahRow.name_en} in Arabic with English translation from The Clear Quran by Mustafa Khattab.`;
  const url = `https://quransays.com/${ch}`;

  return {
    title,
    description,
    openGraph: { title, description, url, siteName: 'QuranSays', type: 'article' },
    twitter: { card: 'summary', title, description },
    alternates: { canonical: url },
  };
}

export default async function SurahPage({ params }: Props) {
  const { chapter } = await params;
  const ch = parseInt(chapter, 10);
  if (!Number.isInteger(ch) || ch < 1 || ch > 114) notFound();

  const surahRow = getSurah(ch);
  if (!surahRow) notFound();

  const ayahs = getAyahsBySurah(ch);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://quransays.com' },
      {
        '@type': 'ListItem',
        position: 2,
        name: `Surah ${surahRow.name_en}`,
        item: `https://quransays.com/${ch}`,
      },
    ],
  };

  const prevSurah = ch > 1 ? ch - 1 : null;
  const nextSurah = ch < 114 ? ch + 1 : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-6">
        {/* Breadcrumb */}
        <nav className="text-sm text-slate-400 flex items-center gap-1">
          <Link href="/" className="hover:text-emerald-400 transition-colors">
            Home
          </Link>
          <span className="mx-1">›</span>
          <span>{surahRow.name_en}</span>
        </nav>

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-emerald-300">{surahRow.name_en}</h1>
          <p className="text-sm text-slate-400 mt-1">
            Surah {ch} · {surahRow.ayah_count} ayahs · The Clear Quran
          </p>
        </div>

        {/* Ayah list */}
        <ol className="flex flex-col gap-3">
          {ayahs.map((a) => (
            <li key={a.ayah}>
              <Link
                href={`/${ch}/${a.ayah}`}
                className="flex items-start gap-4 bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3 hover:border-emerald-600 transition-colors group"
              >
                <span className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-emerald-800 text-emerald-100 text-xs font-bold group-hover:bg-emerald-600 transition-colors">
                  {a.ayah}
                </span>
                <div className="flex flex-col gap-2 min-w-0 flex-1">
                  {a.arabic_text && (
                    <p
                      dir="rtl"
                      lang="ar"
                      className="text-2xl sm:text-3xl leading-relaxed text-slate-100 text-right line-clamp-2"
                      style={{ fontFamily: "'KFGQPCUthmanicScriptHAFS', serif" }}
                    >
                      {a.arabic_text}
                    </p>
                  )}
                  <p className="text-xs text-slate-400 line-clamp-2">{a.display_text}</p>
                </div>
              </Link>
            </li>
          ))}
        </ol>

        {/* Surah navigation */}
        <nav className="flex items-center justify-between gap-4 pt-2">
          {prevSurah ? (
            <Link
              href={`/${prevSurah}`}
              className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:border-emerald-600 text-sm text-slate-300 transition-colors"
            >
              ← Surah {prevSurah}
            </Link>
          ) : (
            <span />
          )}
          {nextSurah ? (
            <Link
              href={`/${nextSurah}`}
              className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:border-emerald-600 text-sm text-slate-300 transition-colors"
            >
              Surah {nextSurah} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </>
  );
}
