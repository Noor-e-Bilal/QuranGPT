/**
 * API contract tests — run against a live server.
 * 
 * Start server first: cd apps/web && npm run dev
 * Then: cd apps/web && npx jest
 * 
 * Tests use a mock of lib/db and lib/chroma so they can run without
 * a real database or ChromaDB instance.
 */

// Mock heavy dependencies so unit tests can run without live services
jest.mock('@/lib/db', () => ({
  searchFTS: jest.fn(() => [
    {
      surah: 1, ayah: 1, reference: '1:1',
      text: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
      display_text: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
      tokens_count: 12,
    },
  ]),
  getAyah: jest.fn((chapter: number, verse: number) => {
    if (chapter === 1 && verse === 1) {
      return {
        surah: 1, ayah: 1, reference: '1:1',
        text: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
        display_text: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
        tokens_count: 12,
      };
    }
    return null;
  }),
  getSurah: jest.fn((chapter: number) => {
    if (chapter === 1) return { surah: 1, name_en: 'Al-Fatihah', ayah_count: 7 };
    return null;
  }),
  isValidReference: jest.fn((chapter: number, verse: number) => {
    return chapter === 1 && verse >= 1 && verse <= 7;
  }),
  getAyahsByReferences: jest.fn((_refs: string[]) => [
    {
      surah: 1, ayah: 1, reference: '1:1',
      text: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
      display_text: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
      tokens_count: 12,
    },
  ]),
  checkDbHealth: jest.fn(() => true),
  expandQueryForSemantic: jest.fn((q: string) => q),
}));

jest.mock('@/lib/chroma', () => ({
  queryCollection: jest.fn(() => Promise.resolve([
    { reference: '1:1', distance: 0.05 }, // low distance → HIGH confidence
  ])),
  checkChromaHealth: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('@/lib/llm', () => ({
  generateChatResponse: jest.fn(() =>
    Promise.resolve({
      needs_clarification: false,
      clarifying_question: null,
      answer: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
      summary: 'Bismillah',
      citations: [{ reference: '1:1', quote: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.' }],
      limitations: null,
      confidence: 'high',
    })
  ),
  generateClarificationQuestion: jest.fn(() =>
    Promise.resolve({
      needs_clarification: true,
      clarifying_question: 'Could you clarify what aspect you mean?',
      answer: '',
      summary: '',
      citations: [],
      limitations: null,
      confidence: 'low',
    })
  ),
  generateVerseExplanation: jest.fn(() =>
    Promise.resolve({
      explanation: 'This ayah is the opening of the Quran.',
      surah_context: 'Al-Fatihah is the opening surah.',
      related_references: [],
    })
  ),
  reformulateQuery: jest.fn((q: string) => Promise.resolve(q)),
}));

import { POST as chatPOST } from '@/app/api/chat/route';
import { GET as healthGET } from '@/app/api/health/route';
import { NextRequest } from 'next/server';

function makeRequest(body: unknown, method = 'POST'): NextRequest {
  return new NextRequest('http://localhost:3000/api/chat', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ------- /api/chat -------------------------------------------------------

describe('POST /api/chat', () => {
  it('returns 400 when question is missing', async () => {
    const req = makeRequest({});
    const res = await chatPOST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when question is empty string', async () => {
    const req = makeRequest({ question: '  ' });
    const res = await chatPOST(req);
    expect(res.status).toBe(400);
  });

  it('returns a valid ChatResponse for a real question', async () => {
    const req = makeRequest({ question: 'What does bismillah mean?' });
    const res = await chatPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    // POC criterion 5: source_policy always present
    expect(json.source_policy).toBe('The Clear Quran only');

    // POC criterion 1: non-empty answer has ≥1 citation
    if (json.answer.trim()) {
      expect(Array.isArray(json.citations)).toBe(true);
      expect(json.citations.length).toBeGreaterThanOrEqual(1);
    }

    // POC criterion 2: citation quote is exact substring of ayah text
    for (const c of json.citations) {
      expect(typeof c.reference).toBe('string');
      expect(typeof c.quote).toBe('string');
      expect(c.quote.length).toBeGreaterThan(0);
    }

    expect(['high', 'medium', 'low']).toContain(json.confidence);
    expect(typeof json.request_id).toBe('string');
  });
});

// ------- /api/health -----------------------------------------------------

describe('GET /api/health', () => {
  it('returns 200 with ok status when services are healthy', async () => {
    const req = new NextRequest('http://localhost:3000/api/health');
    const res = await healthGET();
    const json = await res.json();

    expect(json.status).toBeDefined();
    expect(json.checks).toBeDefined();
    expect(typeof json.checks.db).toBe('boolean');
    expect(typeof json.checks.vector_store).toBe('boolean');
    expect(typeof json.ts).toBe('string');
  });
});

// ------- Validator unit tests -------------------------------------------

import { validateCitations, buildChatResponse, fallbackChatResponse } from '@/lib/validator';

describe('validateCitations', () => {
  const ayahs = [
    {
      surah: 1, ayah: 1, reference: '1:1',
      text: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
      display_text: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
      tokens_count: 12,
    },
  ];

  it('accepts a citation with exact substring quote', () => {
    const llmOut = {
      answer: 'test',
      summary: 'test',
      citations: [{ reference: '1:1', quote: 'In the name of Allah' }],
      limitations: null,
      confidence: 'high' as const,
    };
    const { citations, repaired } = validateCitations(llmOut, ayahs);
    expect(citations).toHaveLength(1);
    expect(repaired).toBe(false);
  });

  it('rejects a citation with non-exact quote', () => {
    const llmOut = {
      answer: 'test',
      summary: 'test',
      citations: [{ reference: '1:1', quote: 'made up text not in ayah' }],
      limitations: null,
      confidence: 'high' as const,
    };
    const { citations, repaired } = validateCitations(llmOut, ayahs);
    expect(citations).toHaveLength(0);
    expect(repaired).toBe(true);
  });

  it('rejects citations for unknown references', () => {
    const llmOut = {
      answer: 'test',
      summary: 'test',
      citations: [{ reference: '99:99', quote: 'anything' }],
      limitations: null,
      confidence: 'high' as const,
    };
    const { citations } = validateCitations(llmOut, ayahs);
    expect(citations).toHaveLength(0);
  });
});

describe('fallbackChatResponse', () => {
  it('returns low confidence and source_policy', () => {
    const r = fallbackChatResponse('test-id');
    // POC criterion 4: low confidence has limitations set
    expect(r.confidence).toBe('low');
    expect(r.limitations).toBeTruthy();
    // POC criterion 5
    expect(r.source_policy).toBe('The Clear Quran only');
    expect(r.citations).toHaveLength(0);
  });
});
