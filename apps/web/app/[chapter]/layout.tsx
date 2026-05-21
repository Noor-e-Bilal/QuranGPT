export default function VerseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-3xl mx-auto px-4 py-6">{children}</div>
    </div>
  );
}
