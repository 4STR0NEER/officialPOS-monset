// The board's signature: each check's table name sits at the summit of contour rings.
// Rings are added and drawn tighter as minutes pass, like contour lines on a steeper slope,
// orange from 15 minutes and red from 30. Static drawing; nothing animates.
export const LATE_MIN = 30;
export const WARN_MIN = 15;

/** A short name for the summit: "T5", "Bar 1" -> "B1", "Take out 3" -> "TO3", "T9 (split)" -> "T9". */
export function ringLabel(label: string) {
  const s = label.replace(/\(.*\)/, '').trim();
  if (s.length <= 3) return s;
  const words = s.split(/\s+/);
  return (words.filter((w) => /^\D/.test(w)).map((w) => w[0].toUpperCase()).join('') + words.filter((w) => /^\d/.test(w)).join('')).slice(0, 4);
}

export function ageTone(minutes: number) {
  return minutes >= LATE_MIN ? 'late' : minutes >= WARN_MIN ? 'warn' : 'calm';
}

export function AgeRings({ minutes, label, size = 72, ground = 'var(--color-paper)' }: { minutes: number; label: string; size?: number; ground?: string }) {
  const tone = ageTone(minutes);
  const stroke = tone === 'late' ? 'var(--color-pin)' : tone === 'warn' ? 'var(--color-contour)' : 'var(--color-steel)';
  // A fixed summit holds the label; contour rings fill the band outside it. More rings in the
  // same band means tighter lines, so age reads as steepness.
  const rings = Math.min(6, 1 + Math.floor(minutes / 6));
  const R = size / 2 - 1.5;
  const summit = size * 0.32;
  const radii = Array.from({ length: rings }, (_, k) => summit + ((R - summit) * (k + 1)) / rings);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="absolute inset-0">
        {radii.map((r, i) => (
          <circle
            key={r}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth={i === radii.length - 1 && tone === 'late' ? 2 : 1.25}
            opacity={0.55 + (0.45 * (i + 1)) / radii.length}
          />
        ))}
        <circle cx={size / 2} cy={size / 2} r={summit} fill={ground} />
      </svg>
      <span className="display absolute inset-0 grid place-items-center leading-none text-ink" style={{ fontSize: `${(label.length <= 2 ? 0.34 : label.length === 3 ? 0.27 : 0.22) * size}px` }}>
        {label}
      </span>
    </div>
  );
}
