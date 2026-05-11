import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getAyah, getSurah, isValidReference, getAyahsByReferences } from '@/lib/db';
import { queryCollection } from '@/lib/chroma';
import { generateVerseExplanation } from '@/lib/llm';
import type { VerseResponse, ApiError } from '@/lib/types';

export async function GET(
  _req: NextRequest,
  { params }: { params: { chapter: string; verse: string } }
) {
  const requestId = uuidv4();
  const chapter = parseInt(params.chapter, 10);
  const verse = parseInt(params.verse, 10);

  if (
    !Number.isInteger(chapter) ||
    !Number.isInteger(verse) ||
    chapter < 1 ||
    chapter > 114 ||
    verse < 1
  ) {
    const err: ApiError = {
      error: {
        code: 'INVALID_REFERENCE',
        message: `Invalid verse reference: ${params.chapter}:${params.verse}`,
        request_id: requestId,
      },
    };
    return NextResponse.json(err, { status: 400 });
  }

  if (!isValidReference(chapter, verse)) {
    const err: ApiError = {
      error: {
        code: 'INVALID_REFERENCE',
        message: `Surah ${chapter} does not have verse ${verse}.`,
        request_id: requestId,
      },
    };
    return NextResponse.json(err, { status: 400 });
  }

  const ayah = getAyah(chapter, verse);
  const surahRow = getSurah(chapter);

  if (!ayah || !surahRow) {
    const err: ApiError = {
      error: {
        code: 'NOT_FOUND',
        message: `Verse ${chapter}:${verse} not found in database.`,
        request_id: requestId,
      },
    };
    return NextResponse.json(err, { status: 404 });
  }

  try {
    const chromaRows = await queryCollection(ayah.display_text, 4).catch(() => []);
    const relatedRefs = chromaRows
      .filter((r) => r.reference !== ayah.reference)
      .slice(0, 3)
      .map((r) => r.reference);
    const relatedAyahs = getAyahsByReferences(relatedRefs);

    const llmOutput = await generateVerseExplanation(ayah, relatedAyahs);

    // Build related_ayah list from LLM output (or fall back to retrieved)
    const usedRefs =
      llmOutput.related_references.length > 0
        ? llmOutput.related_references
        : relatedRefs.slice(0, 3);
    const relatedAyahMap = new Map(relatedAyahs.map((a) => [a.reference, a]));

    const related_ayah = usedRefs
      .map((ref) => {
        const a = relatedAyahMap.get(ref);
        return a ? { reference: ref, quote: a.display_text.slice(0, 120) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const response: VerseResponse = {
      reference: ayah.reference,
      text: ayah.text,
      display_text: ayah.display_text,
      surah_name: surahRow.name_en,
      surah_context: llmOutput.surah_context,
      explanation: llmOutput.explanation,
      related_ayah,
      source_policy: 'The Clear Quran only',
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[/api/verse]', err);
    const apiErr: ApiError = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred generating the verse explanation.',
        request_id: requestId,
      },
    };
    return NextResponse.json(apiErr, { status: 500 });
  }
}
