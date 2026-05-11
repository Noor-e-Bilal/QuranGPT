/**
 * Simple in-memory TTL cache for LLM responses.
 * Keyed by normalised question text. Entries expire after TTL_MS.
 * Bounded to MAX_ENTRIES to prevent memory growth.
 */

const TTL_MS = 5 * 60 * 1_000; // 5 minutes
const MAX_ENTRIES = 500;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    // Evict oldest entry when at capacity
    if (this.map.size >= MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + TTL_MS });
  }
}

// Singleton — Next.js module cache keeps this alive across requests
export const chatCache = new TtlCache<object>();

/** Normalise a question for use as cache key. */
export function normaliseCacheKey(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ');
}
