/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * Pre-warms embedding models so the first user request doesn't pay the cold-start
 * cost of loading the ONNX runtime.
 *
 * BGE-small: awaited (critical path — used for retrieval and L2 cache)
 * BGE-base: fire-and-forget (used for /api/compare and L2 cache)
 *
 * Imports @xenova/transformers directly (not lib/chroma) to avoid pulling
 * chromadb's top-level imports into the instrumentation bundle.
 */

const ECS_CACHE_DIR = '/root/.cache/huggingface';

export async function register() {
  // Only run in the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Wrap everything — a failed pre-warm must NEVER crash the server
  try {
    const xen = await import('@xenova/transformers');
    // Mirror the settings used in lib/chroma.ts.
    // Only override cacheDir when the ECS EFS mount path actually exists;
    // locally it doesn't exist and Xenova should use its default package cache.
    xen.env.useBrowserCache = false;
    // Only override cacheDir in ECS (AWS_EXECUTION_ENV is set in all ECS task environments).
    // Locally it's unset, so Xenova uses its default node_modules cache — no filesystem check needed.
    if (process.env.AWS_EXECUTION_ENV) {
      xen.env.cacheDir = ECS_CACHE_DIR;
    }

    const extractorSmall = await (xen.pipeline as Function)(
      'feature-extraction',
      'Xenova/bge-small-en-v1.5',
    );
    await extractorSmall('warm up', { pooling: 'mean', normalize: true });
    console.log('[instrumentation] BGE-small model pre-warmed');

    // BGE-base: fire-and-forget so it doesn't block server startup / health checks.
    // Ensures model files are on disk before the first /api/compare or L2 cache call.
    (xen.pipeline as Function)('feature-extraction', 'Xenova/bge-base-en-v1.5')
      .then((ext: Function) => ext('warm up', { pooling: 'mean', normalize: true }))
      .then(() => console.log('[instrumentation] BGE-base model pre-warmed'))
      .catch((err: unknown) =>
        console.warn('[instrumentation] BGE-base pre-warm failed (non-fatal):', err),
      );
  } catch (err) {
    console.warn('[instrumentation] model pre-warm failed (non-fatal):', err);
  }
}
