export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center">
      <span className="text-5xl">📭</span>
      <h1 className="text-2xl font-bold text-slate-200">Verse Not Found</h1>
      <p className="text-sm text-slate-400">
        That surah/verse reference does not exist in The Clear Quran index.
      </p>
      <a
        href="/"
        className="mt-2 text-sm text-emerald-400 hover:underline"
      >
        ← Back to Chat
      </a>
    </div>
  );
}
