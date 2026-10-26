import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export const GENESIS_HASH = '0'.repeat(64);

// 12 integer digits + 2 decimals, in centavos: 999,999,999,999.99
export const GRAND_TOTAL_MAX = 99_999_999_999_999;

export class CoreError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Stable JSON: sorted keys, undefined dropped. Everything we hash goes through this. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

export const sha256hex = (s: string): string => bytesToHex(sha256(utf8ToBytes(s)));

/** round(a * b / c), half-up, exact for any safe-integer inputs (BigInt avoids the 2^53 overflow of a*b). */
export function mulDiv(a: number, b: number, c: number): number {
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  const q = n / d;
  const r = n % d;
  return Number(2n * r >= d ? q + 1n : q);
}

export const isCentavos = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

export function peso(c: number): string {
  const s = (Math.abs(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return c < 0 ? `-${s}` : s;
}
