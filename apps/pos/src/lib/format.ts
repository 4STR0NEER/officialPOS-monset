// Centavos -> "1,234.50". Kept local so the screen bundle never pulls in the compliance core.
export function peso(c: number): string {
  const s = (Math.abs(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return c < 0 ? `-${s}` : s;
}

const TZ = 8 * 60 * 60_000; // Philippines, no DST

export const localTime = (iso: string) => new Date(Date.parse(iso) + TZ).toISOString().slice(11, 16);
export const localDate = (iso: string) => new Date(Date.parse(iso) + TZ).toISOString().slice(0, 10);
export const businessDateLabel = () =>
  new Date().toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });

/** "125.50" -> 12550 centavos. Returns null for anything that is not a peso amount. */
export function parsePeso(s: string): number | null {
  const t = s.replace(/[,\s₱]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  return Number(w) * 100 + Number(f.padEnd(2, '0'));
}

export const qty = (milli: number) => (milli % 1000 === 0 ? String(milli / 1000) : (milli / 1000).toFixed(3).replace(/0+$/, ''));
