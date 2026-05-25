import type { MetadataRoute } from 'next';
import { getAllSurahs } from '@/lib/db';

const BASE = 'https://quransays.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const surahs = getAllSurahs();
  const entries: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: new Date(), changeFrequency: 'monthly', priority: 1.0 },
    { url: `${BASE}/chat`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9 },
  ];

  for (const s of surahs) {
    entries.push({
      url: `${BASE}/${s.surah}`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.8,
    });
    for (let v = 1; v <= s.ayah_count; v++) {
      entries.push({
        url: `${BASE}/${s.surah}/${v}`,
        lastModified: new Date(),
        changeFrequency: 'yearly',
        priority: 0.7,
      });
    }
  }

  return entries;
}
