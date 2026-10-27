import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

// The validation seal printed as a QR code on every invoice. It is a signed summary,
// verifiable anywhere with no database: MPOS1.<claims>.<signature>.<public key>, all base64url.
// Phase 5 adds the Monset-signed install certificate that binds the public key to the SLN.

export interface SealClaims {
  sln: string;
  tin: string; // seller TIN + branch
  min: string;
  number: string; // invoice number
  reset: number;
  issuedAt: string; // ISO UTC
  amountDue: number; // centavos
  vat: number; // centavos
}

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// Pipe-joined, not JSON: keeps the QR small enough for 58mm paper.
const pack = (c: SealClaims) => ['1', c.sln, c.tin, c.min, c.number, c.reset, Math.floor(Date.parse(c.issuedAt) / 1000), c.amountDue, c.vat].join('|');

export function newSealKey(): { secret: string; public: string } {
  const sk = ed25519.utils.randomSecretKey();
  return { secret: bytesToHex(sk), public: bytesToHex(ed25519.getPublicKey(sk)) };
}

export function signSeal(claims: SealClaims, key: { secret: string; public: string }): string {
  const msg = utf8ToBytes(pack(claims));
  return ['MPOS1', b64u(msg), b64u(ed25519.sign(msg, hexToBytes(key.secret))), b64u(hexToBytes(key.public))].join('.');
}

export function verifySeal(seal: string): { valid: boolean; claims: SealClaims | null; publicKey: string | null } {
  try {
    const [tag, m, s, k] = seal.split('.');
    if (tag !== 'MPOS1') return { valid: false, claims: null, publicKey: null };
    const msg = unb64u(m);
    const pub = unb64u(k);
    const valid = ed25519.verify(unb64u(s), msg, pub);
    const f = new TextDecoder().decode(msg).split('|');
    const claims: SealClaims = {
      sln: f[1], tin: f[2], min: f[3], number: f[4], reset: Number(f[5]),
      issuedAt: new Date(Number(f[6]) * 1000).toISOString(), amountDue: Number(f[7]), vat: Number(f[8]),
    };
    return { valid, claims, publicKey: bytesToHex(pub) };
  } catch {
    return { valid: false, claims: null, publicKey: null };
  }
}
