'use client';

interface FrameProps {
  arabic: string;
  surah: number;
  ayah: number;
}

type Frame = {
  outerBg: string;
  accent: string;
  innerBg: string;
  textColor: string;
  glowColor: string;
};

const FRAMES: Frame[] = [
  { outerBg: '#022c22', accent: '#10b981', innerBg: '#064e3b', textColor: '#d1fae5', glowColor: 'rgba(16,185,129,0.4)' },
  { outerBg: '#1c1000', accent: '#f59e0b', innerBg: '#2c1800', textColor: '#fef3c7', glowColor: 'rgba(245,158,11,0.4)' },
  { outerBg: '#0c1a3d', accent: '#3b82f6', innerBg: '#1e3a8a', textColor: '#dbeafe', glowColor: 'rgba(59,130,246,0.4)' },
  { outerBg: '#13002b', accent: '#a855f7', innerBg: '#2e1065', textColor: '#ede9fe', glowColor: 'rgba(168,85,247,0.4)' },
  { outerBg: '#1a0010', accent: '#f43f5e', innerBg: '#4c0519', textColor: '#ffe4e6', glowColor: 'rgba(244,63,94,0.4)' },
  { outerBg: '#001a1a', accent: '#14b8a6', innerBg: '#134e4a', textColor: '#ccfbf1', glowColor: 'rgba(20,184,166,0.4)' },
  { outerBg: '#0f172a', accent: '#94a3b8', innerBg: '#1e293b', textColor: '#f1f5f9', glowColor: 'rgba(148,163,184,0.4)' },
  { outerBg: '#1a0f00', accent: '#d97706', innerBg: '#292524', textColor: '#fef3c7', glowColor: 'rgba(217,119,6,0.4)' },
  { outerBg: '#060830', accent: '#818cf8', innerBg: '#1e1b4b', textColor: '#e0e7ff', glowColor: 'rgba(129,140,248,0.4)' },
  { outerBg: '#001a00', accent: '#22c55e', innerBg: '#14532d', textColor: '#dcfce7', glowColor: 'rgba(34,197,94,0.4)' },
  { outerBg: '#001a1f', accent: '#06b6d4', innerBg: '#164e63', textColor: '#cffafe', glowColor: 'rgba(6,182,212,0.4)' },
  { outerBg: '#1a0015', accent: '#ec4899', innerBg: '#500724', textColor: '#fce7f3', glowColor: 'rgba(236,72,153,0.4)' },
  { outerBg: '#1a0020', accent: '#d946ef', innerBg: '#4a044e', textColor: '#fae8ff', glowColor: 'rgba(217,70,239,0.4)' },
  { outerBg: '#0d1a00', accent: '#84cc16', innerBg: '#1a2e05', textColor: '#f7fee7', glowColor: 'rgba(132,204,22,0.4)' },
  { outerBg: '#001428', accent: '#38bdf8', innerBg: '#0c4a6e', textColor: '#e0f2fe', glowColor: 'rgba(56,189,248,0.4)' },
  { outerBg: '#1a0800', accent: '#f97316', innerBg: '#431407', textColor: '#ffedd5', glowColor: 'rgba(249,115,22,0.4)' },
  { outerBg: '#1a0000', accent: '#ef4444', innerBg: '#450a0a', textColor: '#fee2e2', glowColor: 'rgba(239,68,68,0.4)' },
  { outerBg: '#1a1000', accent: '#eab308', innerBg: '#422006', textColor: '#fefce8', glowColor: 'rgba(234,179,8,0.4)' },
  { outerBg: '#09090b', accent: '#a1a1aa', innerBg: '#18181b', textColor: '#f4f4f5', glowColor: 'rgba(161,161,170,0.4)' },
  { outerBg: '#1c0e00', accent: '#cd7f32', innerBg: '#2d1b00', textColor: '#fef3c7', glowColor: 'rgba(205,127,50,0.4)' },
  { outerBg: '#001818', accent: '#059669', innerBg: '#0d3d36', textColor: '#a7f3d0', glowColor: 'rgba(5,150,105,0.4)' },
  { outerBg: '#0f0030', accent: '#f59e0b', innerBg: '#3b0764', textColor: '#fef3c7', glowColor: 'rgba(168,85,247,0.4)' },
  { outerBg: '#01082a', accent: '#cbd5e1', innerBg: '#1e3a8a', textColor: '#f8fafc', glowColor: 'rgba(203,213,225,0.4)' },
  { outerBg: '#001200', accent: '#ca8a04', innerBg: '#052e16', textColor: '#fef9c3', glowColor: 'rgba(202,138,4,0.4)' },
  { outerBg: '#2a0000', accent: '#f8fafc', innerBg: '#7f1d1d', textColor: '#ffffff', glowColor: 'rgba(248,250,252,0.25)' },
  { outerBg: '#001a1a', accent: '#f59e0b', innerBg: '#083344', textColor: '#fef3c7', glowColor: 'rgba(6,182,212,0.4)' },
  { outerBg: '#01020f', accent: '#7c3aed', innerBg: '#0f172a', textColor: '#ddd6fe', glowColor: 'rgba(124,58,237,0.4)' },
  { outerBg: '#171512', accent: '#10b981', innerBg: '#1c1917', textColor: '#a7f3d0', glowColor: 'rgba(16,185,129,0.4)' },
  { outerBg: '#050b1f', accent: '#fb7185', innerBg: '#312e81', textColor: '#ffe4e6', glowColor: 'rgba(251,113,133,0.4)' },
  { outerBg: '#030712', accent: '#2dd4bf', innerBg: '#111827', textColor: '#99f6e4', glowColor: 'rgba(45,212,191,0.4)' },
];

/** 8-pointed Islamic star (rub el hizb style) */
function CornerStar({ color }: { color: string }) {
  return (
    <svg width="32" height="32" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M47,25 L33.3,21.6 L40.6,9.4 L28.4,16.7 L25,3 L21.6,16.7 L9.4,9.4 L16.7,21.6 L3,25 L16.7,28.4 L9.4,40.6 L21.6,33.3 L25,47 L28.4,33.3 L40.6,40.6 L33.3,28.4 Z"
        fill={color}
        opacity="0.92"
      />
      <circle cx="25" cy="25" r="5.5" fill={color} opacity="0.65" />
      <circle cx="25" cy="25" r="2.5" fill={color} opacity="0.9" />
    </svg>
  );
}

/** Decorative separator line with diamonds */
function OrnamentLine({ color, label }: { color: string; label?: string }) {
  return (
    <div className="flex items-center w-full gap-2">
      {/* left arm */}
      <svg viewBox="0 0 120 16" className="flex-1 h-4" preserveAspectRatio="none">
        <line x1="0" y1="8" x2="100" y2="8" stroke={color} strokeWidth="0.8" opacity="0.5" />
        <polygon points="108,5 116,8 108,11 100,8" fill={color} opacity="0.65" />
      </svg>

      {label ? (
        <span
          className="shrink-0 text-[10px] font-mono tracking-[0.4em]"
          style={{ color, opacity: 0.85 }}
        >
          {label}
        </span>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18">
          <polygon points="12,2 20,12 12,22 4,12" fill={color} opacity="0.7" />
          <polygon points="12,6 17,12 12,18 7,12" fill={color} opacity="0.4" />
        </svg>
      )}

      {/* right arm */}
      <svg viewBox="0 0 120 16" className="flex-1 h-4" preserveAspectRatio="none">
        <polygon points="12,5 20,8 12,11 4,8" fill={color} opacity="0.65" />
        <line x1="20" y1="8" x2="120" y2="8" stroke={color} strokeWidth="0.8" opacity="0.5" />
      </svg>
    </div>
  );
}

function pickFrame(surah: number, ayah: number): Frame {
  return FRAMES[(surah * 17 + ayah * 31) % FRAMES.length];
}

export default function AyahFrame({ arabic, surah, ayah }: FrameProps) {
  const f = pickFrame(surah, ayah);

  // Encode accent color for SVG data URI background pattern
  const patternColor = encodeURIComponent(f.accent);
  const bgPattern = `url("data:image/svg+xml,%3Csvg width='70' height='70' viewBox='0 0 70 70' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M35 8L38.5 28L58 22L45 35L58 48L38.5 42L35 62L31.5 42L12 48L25 35L12 22L31.5 28Z' fill='${patternColor}' opacity='0.05'/%3E%3C/svg%3E")`;

  return (
    /* Outer wrapper — provides room for the absolute-positioned corner stars */
    <div className="relative px-4 py-4">
      {/* Corner ornaments sit at the very corners of this wrapper */}
      <div className="absolute top-0 left-0"><CornerStar color={f.accent} /></div>
      <div className="absolute top-0 right-0" style={{ transform: 'rotate(90deg)' }}><CornerStar color={f.accent} /></div>
      <div className="absolute bottom-0 left-0" style={{ transform: 'rotate(-90deg)' }}><CornerStar color={f.accent} /></div>
      <div className="absolute bottom-0 right-0" style={{ transform: 'rotate(180deg)' }}><CornerStar color={f.accent} /></div>

      {/* Outer ring — gives the glow + outermost border */}
      <div
        className="rounded-2xl"
        style={{
          background: f.outerBg,
          border: `2px solid ${f.accent}55`,
          boxShadow: `0 0 40px -8px ${f.glowColor}, 0 20px 60px -20px ${f.glowColor}`,
          padding: '5px',
        }}
      >
        {/* Middle ring — 1px line gap from outer */}
        <div
          className="rounded-xl"
          style={{
            border: `1px solid ${f.accent}80`,
            padding: '4px',
            background: f.outerBg,
          }}
        >
          {/* Inner content panel */}
          <div
            className="relative rounded-lg overflow-hidden px-8 pt-5 pb-5"
            style={{
              background: f.innerBg,
              border: `1.5px solid ${f.accent}`,
              backgroundImage: bgPattern,
              backgroundSize: '70px 70px',
            }}
          >
            {/* Top separator with reference */}
            <div className="mb-5 mt-1">
              <OrnamentLine color={f.accent} label={`${surah} : ${ayah}`} />
            </div>

            {/* Arabic text — large, centered, RTL */}
            <p
              dir="rtl"
              lang="ar"
              className="text-4xl sm:text-5xl text-center select-text"
              style={{
                fontFamily: "'KFGQPCUthmanicScriptHAFS', serif",
                color: f.textColor,
                lineHeight: 2.4,
                textShadow: `0 2px 12px ${f.glowColor}`,
              }}
            >
              {arabic}
            </p>

            {/* Bottom separator */}
            <div className="mt-5 mb-1">
              <OrnamentLine color={f.accent} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
