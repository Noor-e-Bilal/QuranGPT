'use client';

interface FrameProps {
  arabic: string;
  surah: number;
  ayah: number;
}

// 30 deterministic frame variants — color palette, border style, ornament, and layout
const FRAMES = [
  // 0 — deep emerald with double border
  { outer: 'bg-emerald-950', border: 'border-4 border-double border-emerald-500', inner: 'bg-emerald-900/60', text: 'text-emerald-50', ornament: '✦' },
  // 1 — gold parchment
  { outer: 'bg-amber-950', border: 'border-4 border-double border-amber-500', inner: 'bg-amber-900/50', text: 'text-amber-50', ornament: '❋' },
  // 2 — sapphire blue
  { outer: 'bg-blue-950', border: 'border-4 border-double border-blue-500', inner: 'bg-blue-900/60', text: 'text-blue-50', ornament: '✧' },
  // 3 — deep violet
  { outer: 'bg-violet-950', border: 'border-4 border-double border-violet-400', inner: 'bg-violet-900/60', text: 'text-violet-50', ornament: '❖' },
  // 4 — rose / burgundy
  { outer: 'bg-rose-950', border: 'border-4 border-double border-rose-400', inner: 'bg-rose-900/50', text: 'text-rose-50', ornament: '✿' },
  // 5 — teal
  { outer: 'bg-teal-950', border: 'border-4 border-double border-teal-400', inner: 'bg-teal-900/60', text: 'text-teal-50', ornament: '✦' },
  // 6 — slate silver
  { outer: 'bg-slate-900', border: 'border-4 border-double border-slate-400', inner: 'bg-slate-800/80', text: 'text-slate-50', ornament: '❋' },
  // 7 — warm brown / earth
  { outer: 'bg-stone-900', border: 'border-4 border-double border-stone-400', inner: 'bg-stone-800/70', text: 'text-stone-100', ornament: '✧' },
  // 8 — indigo midnight
  { outer: 'bg-indigo-950', border: 'border-4 border-double border-indigo-400', inner: 'bg-indigo-900/60', text: 'text-indigo-50', ornament: '❖' },
  // 9 — forest green
  { outer: 'bg-green-950', border: 'border-4 border-double border-green-400', inner: 'bg-green-900/60', text: 'text-green-50', ornament: '✿' },
  // 10 — cyan ocean
  { outer: 'bg-cyan-950', border: 'border-4 border-double border-cyan-400', inner: 'bg-cyan-900/60', text: 'text-cyan-50', ornament: '✦' },
  // 11 — pink blush
  { outer: 'bg-pink-950', border: 'border-4 border-double border-pink-400', inner: 'bg-pink-900/50', text: 'text-pink-50', ornament: '❋' },
  // 12 — fuchsia
  { outer: 'bg-fuchsia-950', border: 'border-4 border-double border-fuchsia-400', inner: 'bg-fuchsia-900/60', text: 'text-fuchsia-50', ornament: '✧' },
  // 13 — lime / spring
  { outer: 'bg-lime-950', border: 'border-4 border-double border-lime-400', inner: 'bg-lime-900/60', text: 'text-lime-50', ornament: '❖' },
  // 14 — sky blue
  { outer: 'bg-sky-950', border: 'border-4 border-double border-sky-400', inner: 'bg-sky-900/60', text: 'text-sky-50', ornament: '✿' },
  // 15 — orange spice
  { outer: 'bg-orange-950', border: 'border-4 border-double border-orange-400', inner: 'bg-orange-900/50', text: 'text-orange-50', ornament: '✦' },
  // 16 — red deep
  { outer: 'bg-red-950', border: 'border-4 border-double border-red-400', inner: 'bg-red-900/50', text: 'text-red-50', ornament: '❋' },
  // 17 — warm yellow / honey
  { outer: 'bg-yellow-950', border: 'border-4 border-double border-yellow-400', inner: 'bg-yellow-900/50', text: 'text-yellow-50', ornament: '✧' },
  // 18 — midnight navy
  { outer: 'bg-zinc-950', border: 'border-4 border-double border-zinc-400', inner: 'bg-zinc-800/80', text: 'text-zinc-50', ornament: '❖' },
  // 19 — copper bronze
  { outer: 'bg-amber-900', border: 'border-4 border-double border-yellow-600', inner: 'bg-amber-800/70', text: 'text-yellow-50', ornament: '✿' },
  // 20 — dark teal + emerald accent
  { outer: 'bg-teal-900', border: 'border-4 border-double border-emerald-400', inner: 'bg-teal-800/70', text: 'text-emerald-50', ornament: '✦' },
  // 21 — purple + gold
  { outer: 'bg-purple-950', border: 'border-4 border-double border-yellow-400', inner: 'bg-purple-900/60', text: 'text-yellow-50', ornament: '❋' },
  // 22 — dark blue + silver
  { outer: 'bg-blue-950', border: 'border-4 border-double border-slate-300', inner: 'bg-blue-900/60', text: 'text-slate-50', ornament: '✧' },
  // 23 — forest + gold
  { outer: 'bg-green-900', border: 'border-4 border-double border-yellow-500', inner: 'bg-green-800/70', text: 'text-yellow-50', ornament: '❖' },
  // 24 — dark crimson + white
  { outer: 'bg-red-900', border: 'border-4 border-double border-white', inner: 'bg-red-800/70', text: 'text-white', ornament: '✿' },
  // 25 — ocean + amber
  { outer: 'bg-cyan-900', border: 'border-4 border-double border-amber-400', inner: 'bg-cyan-800/70', text: 'text-amber-50', ornament: '✦' },
  // 26 — slate + violet
  { outer: 'bg-slate-950', border: 'border-4 border-double border-violet-400', inner: 'bg-slate-800/80', text: 'text-violet-100', ornament: '❋' },
  // 27 — stone + emerald
  { outer: 'bg-stone-950', border: 'border-4 border-double border-emerald-400', inner: 'bg-stone-800/80', text: 'text-emerald-50', ornament: '✧' },
  // 28 — deep indigo + rose accent
  { outer: 'bg-indigo-900', border: 'border-4 border-double border-rose-400', inner: 'bg-indigo-800/70', text: 'text-rose-50', ornament: '❖' },
  // 29 — classic dark + bright teal
  { outer: 'bg-gray-950', border: 'border-4 border-double border-teal-400', inner: 'bg-gray-800/80', text: 'text-teal-50', ornament: '✿' },
] as const;

function pickFrame(surah: number, ayah: number) {
  return FRAMES[(surah * 17 + ayah * 31) % FRAMES.length];
}

export default function AyahFrame({ arabic, surah, ayah }: FrameProps) {
  const f = pickFrame(surah, ayah);
  return (
    <div className={`rounded-2xl p-1.5 ${f.outer} shadow-2xl`}>
      <div className={`rounded-xl p-6 ${f.border} ${f.inner}`}>
        {/* top ornament row */}
        <div className={`flex items-center justify-center gap-3 mb-6 ${f.text} opacity-60 text-lg tracking-widest select-none`}>
          <span>{f.ornament}</span>
          <span className="w-20 h-px bg-current opacity-50" />
          <span className="text-xs font-mono tracking-[0.4em] uppercase opacity-80">
            {surah}:{ayah}
          </span>
          <span className="w-20 h-px bg-current opacity-50" />
          <span>{f.ornament}</span>
        </div>

        {/* Arabic text */}
        <p
          dir="rtl"
          lang="ar"
          className={`font-arabic text-3xl sm:text-4xl leading-[2.4] text-center ${f.text} select-text`}
          style={{ fontFamily: "'KFGQPCUthmanicScriptHAFS', serif" }}
        >
          {arabic}
        </p>

        {/* bottom ornament row */}
        <div className={`flex items-center justify-center gap-3 mt-6 ${f.text} opacity-60 text-lg tracking-widest select-none`}>
          <span>{f.ornament}</span>
          <span className="w-20 h-px bg-current opacity-50" />
          <span>{f.ornament}</span>
        </div>
      </div>
    </div>
  );
}
