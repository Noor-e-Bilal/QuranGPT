/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * Pre-warms the BGE-small embedding model so the first user request doesn't
 * pay the 300-400ms cold-start cost of loading the ONNX runtime.
 *
 * Imports @xenova/transformers directly (not lib/chroma) to avoid pulling
 * chromadb's top-level imports into the instrumentation bundle.
 */
export async function register() {
  // Only run in the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Wrap everything — a failed pre-warm must NEVER crash the server
  try {
    const xen = await import('@xenova/transformers');
    // Mirror the settings used in lib/chroma.ts
    xen.env.useBrowserCache = false;
    xen.env.cacheDir = '/root/.cache/huggingface';
    const extractor = await (xen.pipeline as Function)(
      'feature-extraction',
      'Xenova/bge-small-en-v1.5',
    );
    await extractor('warm up', { pooling: 'mean', normalize: true });
    console.log('[instrumentation] BGE-small model pre-warmed');
  } catch (err) {
    console.warn('[instrumentation] model pre-warm failed (non-fatal):', err);
  }
}
