import { renderSVG } from 'uqr';
import { peso } from './util.ts';

// One document model, three renderers: fixed-width text (the e-journal and golden files),
// ESC/POS bytes for thermal printers, and A4 HTML. Blocks are stored with the journal, so a
// reprint years later renders exactly what was issued.
export const LAYOUT_VERSION = 'p2';

export const SUPPLEMENTARY_FOOTER = 'THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.';
export const DEMO_WATERMARK = 'DEMO, NOT FOR LIVE USE, NOT A VALID INVOICE';
export const SUPPLEMENTARY = new Set(['VOID', 'REFUND', 'RETURN', 'CANCEL', 'ORDER', 'ACK', 'COLLECTION', 'MANUAL']);

export type Block =
  | { k: 'center'; text: string; bold?: boolean; big?: boolean }
  | { k: 'text'; text: string; bold?: boolean }
  | { k: 'pair'; l: string; r: string; bold?: boolean }
  | { k: 'rule'; ch?: '-' | '=' }
  | { k: 'item'; desc: string; qty: string; unit: string; amount: string }
  | { k: 'sig'; label: string }
  | { k: 'qr'; data: string };

export const COLUMNS = { '58': 32, '80': 48, A4: 64 } as const;
export type Paper = keyof typeof COLUMNS;

const TITLES: Record<string, string> = {
  INVOICE: 'INVOICE', VOID: 'VOID', REFUND: 'REFUND', RETURN: 'RETURN', CANCEL: 'CANCELLATION', ORDER: 'ORDER SLIP',
  ACK: 'ACKNOWLEDGMENT RECEIPT', COLLECTION: 'COLLECTION RECEIPT', MANUAL: 'MANUAL INVOICE RECORD', X: 'X READING', Z: 'Z READING',
};

export interface DocMeta {
  docType: string;
  number: string;
  resetCounter: number;
  issuedAt: string; // ISO UTC
  offline: boolean;
  userId: string;
  coreVersion: string;
  tzMinutes: number;
}

export const localTime = (iso: string, tzMinutes: number) =>
  new Date(Date.parse(iso) + tzMinutes * 60_000).toISOString().replace('T', ' ').slice(0, 19);

const qty = (milli: number) => (milli % 1000 === 0 ? String(milli / 1000) : (milli / 1000).toFixed(3));
const neg = (c: number) => (c ? `-${peso(c)}` : peso(0));
const pct = (bp: number) => `${bp / 100}%`;
const blank = '____________________';

// Bodies differ per document type; the builder renders whatever is present.
export function buildBlocks(m: DocMeta, b: any): Block[] {
  const h = b.header ?? {};
  const s = h.seller ?? {};
  const t = h.terminal ?? {};
  const sup = h.supplier ?? {};
  const out: Block[] = [];
  const pair = (l: string, r: string | number | null | undefined, bold = false) => out.push({ k: 'pair', l, r: r == null || r === '' ? '-' : String(r), bold });
  const center = (text: string, o: { bold?: boolean; big?: boolean } = {}) => text && out.push({ k: 'center', text, ...o });
  const rule = (ch: '-' | '=' = '-') => out.push({ k: 'rule', ch });
  const demo = t.mode === 'DEMO';

  if (demo) center(DEMO_WATERMARK, { bold: true });
  center(s.registeredName ?? '[SELLER NOT SET]', { bold: true });
  center(s.businessName ?? '');
  center(s.address ?? '');
  center(`${t.vatMode === 'VAT' ? 'VAT REG TIN' : 'NON VAT REG TIN'} ${s.tin ?? '[TO BE ISSUED]'}`);
  center(`MIN: ${t.min ?? '[TO BE ISSUED]'}`);
  if (t.serial) center(`SN: ${t.serial}`);
  center(`SLN: ${t.sln ?? '[TO BE ISSUED]'}`);
  rule('=');
  center(TITLES[m.docType] ?? m.docType, { bold: true, big: true });
  if (m.docType === 'INVOICE' && t.vatMode === 'EXEMPT') center('EXEMPT', { bold: true, big: true });
  pair(`${m.docType === 'INVOICE' ? 'Invoice' : 'Document'} No.`, m.number, true);
  if (m.resetCounter) pair('Reset counter', m.resetCounter);
  pair('Date', localTime(m.issuedAt, m.tzMinutes));
  pair('Terminal / user', `${t.terminalId ?? '-'} / ${m.userId}`);
  if (b.original) pair('Reference', `${b.original.type ?? 'INVOICE'} ${b.original.number}`);
  if (b.reason) pair('Reason', b.reason);
  if (b.approvedBy) pair('Approved by', b.approvedBy);
  if (b.manualNo) {
    pair('Manual invoice no.', b.manualNo);
    pair('Manual invoice date', b.issuedOn);
    if (b.linkedNumber) pair('Replaces system invoice', b.linkedNumber);
  }
  rule();

  if (m.docType === 'INVOICE' || m.docType === 'MANUAL') {
    const buyer = b.buyer ?? {};
    pair('Sold to', buyer.name ?? blank);
    pair('Address', buyer.address ?? blank);
    pair('TIN', buyer.tin ?? blank);
    pair('Business style', buyer.businessStyle ?? blank);
    rule();
  }
  if (b.party) {
    pair('Received from', b.party.name ?? blank);
    if (b.party.tin) pair('TIN', b.party.tin);
    if (b.party.address) pair('Address', b.party.address);
  }
  if (b.reference) pair('For', b.reference);
  if (b.memo) out.push({ k: 'text', text: b.memo });

  for (const l of b.lines ?? []) {
    out.push({ k: 'item', desc: l.description, qty: qty(l.qtyMilli), unit: l.unitPrice == null ? '' : peso(l.unitPrice), amount: peso(l.gross) });
  }
  if (b.lines?.length) rule();

  const tt = b.totals;
  if (tt) {
    pair('Total sales', peso(tt.gross));
    // Order of operations, as computed: VAT comes off first, then the discounts.
    if (tt.vatExemption) pair('Less: VAT exemption', neg(tt.vatExemption));
    for (const [k, v] of Object.entries(tt.discounts ?? {}) as [string, number][]) {
      const sd = (b.specialDiscounts ?? []).find((x: any) => x.type === k);
      pair(`Less: ${k} discount${sd ? ` (${pct(sd.rateBp)})` : ''}`, neg(v)); // full name is in the holder block below
    }
    pair(m.docType === 'INVOICE' || m.docType === 'MANUAL' ? 'AMOUNT DUE' : 'TOTAL', peso(tt.net), true);
    rule();
    const vm = b.vatMode ?? t.vatMode;
    if (vm === 'VAT') {
      pair('VATable sales', peso(tt.vatable));
      pair(`VAT amount (${pct(b.vatRateBp ?? 1200)})`, peso(tt.vat));
      pair('VAT-exempt sales', peso(tt.exempt));
      pair('Zero-rated sales', peso(tt.zeroRated));
    } else if (vm === 'NONVAT') {
      pair('Sales subject to percentage tax', peso(tt.nonVatTaxable));
      pair('Exempt sales', peso(tt.exempt));
    } else {
      pair('Exempt sales', peso(tt.exempt));
    }
  } else if (b.total != null) {
    pair('TOTAL', peso(b.total), true);
  }
  if (b.amount != null) pair('AMOUNT RECEIVED', peso(b.amount), true);

  const list = (x: unknown): any[] => (Array.isArray(x) ? x : []); // readings carry summary objects under the same names
  if (list(b.payments).length || list(b.refunds).length) rule();
  for (const p of list(b.payments)) pair(p.method, peso(p.amount));
  if (b.change) pair('Change', peso(b.change));
  for (const p of list(b.refunds)) pair(`Refunded (${p.method})`, peso(p.amount));

  for (const sd of b.specialDiscounts ?? []) {
    rule();
    out.push({ k: 'text', text: `${sd.label.toUpperCase()} DISCOUNT`, bold: true });
    pair('Name', sd.holder.name);
    pair(`ID${sd.holder.idType ? ` (${sd.holder.idType})` : ''} No.`, sd.holder.idNo);
    pair('TIN', sd.holder.tin ?? '-');
    if (sd.basis === 'GROUP_SHARE') pair('Share of group order', `1/${sd.diners}`);
    pair('Covered amount', peso(sd.coveredGross));
    pair('Less: VAT exemption', neg(sd.vatExemption));
    pair(`Less: discount (${pct(sd.rateBp)})`, neg(sd.discount));
    pair('Net', peso(sd.net));
    if (sd.channel !== 'ONLINE') out.push({ k: 'sig', label: 'Signature' });
  }

  if (m.docType === 'X' || m.docType === 'Z') readingBlocks(b, pair, rule);

  if (b.seal) {
    rule();
    out.push({ k: 'qr', data: b.seal });
  }

  rule('=');
  if (m.docType !== 'X' && m.docType !== 'Z') {
    pair('Supplier', sup.name ?? '[TO BE ISSUED]');
    pair('Supplier address', sup.address ?? '[TO BE ISSUED]');
    pair('Supplier TIN', sup.tin ?? '[TO BE ISSUED]');
    pair('Accreditation No.', sup.accreditationNo ?? '[TO BE ISSUED]');
    pair('Date issued', sup.accreditationIssued ?? '[TO BE ISSUED]');
    pair('Valid until', sup.accreditationValidUntil ?? '[TO BE ISSUED]');
    pair(t.ptuLabel ?? 'PTU No.', t.ptuNo ?? '[TO BE ISSUED]');
    pair('Date issued', t.ptuDate ?? '[TO BE ISSUED]');
  }
  center(`Monset POS Core v${m.coreVersion}`);
  if (m.offline) center('[ISSUED OFFLINE]');
  if (SUPPLEMENTARY.has(m.docType)) center(SUPPLEMENTARY_FOOTER, { bold: true });
  if (demo) center(DEMO_WATERMARK, { bold: true });
  return out;
}

function readingBlocks(r: any, pair: (l: string, v: string | number | null) => void, rule: () => void) {
  pair('Ledger range', `${r.fromSeq} - ${r.toSeq}`);
  pair('Beginning invoice', r.beginInvoice ?? '-');
  pair('Ending invoice', r.endInvoice ?? '-');
  pair('Beginning grand total', peso(r.beginGrandTotal));
  pair('Ending grand total', peso(r.endGrandTotal));
  pair('Reset counter', r.endResetCounter);
  pair('Z counter', r.zCounter);
  rule();
  const s = r.sales;
  pair('Gross sales', peso(s.gross));
  for (const [k, v] of Object.entries(s.discounts) as [string, number][]) pair(`Less: ${k} discount`, neg(v));
  pair('Less: VAT exemption', neg(s.vatExemption ?? 0));
  pair('Less: voids', `${neg(r.voids.amount)} (${r.voids.count})`);
  pair('Less: refunds', `${neg(r.refunds.amount)} (${r.refunds.count})`);
  pair('Less: returns', `${neg(r.returns.amount)} (${r.returns.count})`);
  pair('NET SALES', peso(r.netSales));
  rule();
  pair('VATable sales', peso(s.vatable));
  pair('VAT amount', peso(s.vat));
  pair('VAT-exempt sales', peso(s.exempt));
  pair('Zero-rated sales', peso(s.zeroRated));
  if (s.nonVatTaxable) pair('Sales subject to percentage tax', peso(s.nonVatTaxable));
  pair('Invoices issued', r.invoiceCount);
  if (r.manual?.count) pair('Manual invoices recorded', `${peso(r.manual.amount)} (${r.manual.count})`);
  rule();
  for (const [k, v] of Object.entries(r.payments) as [string, number][]) pair(k, peso(v));
}

export function withReprintBanner(blocks: Block[], copyNo: number, at: string, userId: string): Block[] {
  return [{ k: 'center', text: `*** REPRINT #${copyNo} ***`, bold: true, big: true }, { k: 'center', text: `Reprinted ${at} by ${userId}` }, ...blocks];
}

/* ---------- text ---------- */

function wrap(s: string, w: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    for (let piece = word; piece; piece = piece.slice(w)) {
      const chunk = piece.slice(0, w);
      if (!cur) cur = chunk;
      else if (cur.length + 1 + chunk.length <= w) cur += ` ${chunk}`;
      else {
        out.push(cur);
        cur = chunk;
      }
    }
  }
  return cur || !out.length ? [...out, cur] : out;
}

const centered = (s: string, w: number) => ' '.repeat(Math.max(0, Math.floor((w - s.length) / 2))) + s;
const twoCol = (l: string, r: string, w: number) =>
  l.length + 1 + r.length <= w ? l + ' '.repeat(w - l.length - r.length) + r : [...wrap(l, w), r.padStart(w)].join('\n');

/** Text lines for one block; big text is laid out at half width (double-width print). */
function lines(b: Block, w: number): string[] {
  switch (b.k) {
    case 'center':
      return wrap(b.text, b.big ? Math.floor(w / 2) : w).map((x) => centered(x, b.big ? Math.floor(w / 2) : w));
    case 'text':
      return wrap(b.text, w);
    case 'pair':
      return twoCol(b.l, b.r, w).split('\n');
    case 'rule':
      return [(b.ch ?? '-').repeat(w)];
    case 'item':
      return [...wrap(b.desc, w), twoCol(`  ${b.qty} x ${b.unit}`, b.amount, w)];
    case 'sig':
      return ['', `${b.label}: ${'_'.repeat(Math.max(8, w - b.label.length - 2))}`];
    case 'qr':
      return wrap(`Seal: ${b.data}`, w);
  }
}

export function renderText(blocks: Block[], cols: number): string {
  return blocks
    .flatMap((b) => (b.k === 'center' && b.big ? lines(b, cols).map((l) => centered(l.trim(), cols)) : lines(b, cols)))
    .map((l) => l.trimEnd())
    .join('\n');
}

/* ---------- ESC/POS ---------- */

const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');

export function renderEscPos(blocks: Block[], cols: number): Uint8Array {
  const out: number[] = [0x1b, 0x40]; // initialise
  const text = (s: string) => {
    for (const ch of ascii(s)) out.push(ch.charCodeAt(0));
    out.push(0x0a);
  };
  for (const b of blocks) {
    const bold = 'bold' in b && !!b.bold;
    const big = b.k === 'center' && !!b.big;
    if (bold) out.push(0x1b, 0x45, 1);
    if (big) out.push(0x1d, 0x21, 0x11);
    if (b.k === 'qr') {
      const data = Array.from(ascii(b.data), (c) => c.charCodeAt(0));
      const n = data.length + 3;
      out.push(0x1b, 0x61, 1); // centre
      out.push(0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0); // model 2
      out.push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, cols <= 32 ? 4 : 6); // module size
      out.push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31); // error correction M
      out.push(0x1d, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30, ...data); // store
      out.push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30); // print
      out.push(0x1b, 0x61, 0, 0x0a);
    } else {
      for (const l of lines(b, cols)) text(big ? l.trim() && centered(l.trim(), Math.floor(cols / 2)) : l);
    }
    if (big) out.push(0x1d, 0x21, 0);
    if (bold) out.push(0x1b, 0x45, 0);
  }
  out.push(0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0); // feed and cut
  return Uint8Array.from(out);
}

/* ---------- A4 HTML ---------- */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderHtml(blocks: Block[], title: string): string {
  const body: string[] = [];
  let rows: string[] = [];
  const flush = () => {
    if (rows.length) body.push(`<table><thead><tr><th>Qty</th><th>Description</th><th>Unit cost</th><th>Amount</th></tr></thead><tbody>${rows.join('')}</tbody></table>`);
    rows = [];
  };
  for (const b of blocks) {
    if (b.k === 'item') {
      rows.push(`<tr><td>${esc(b.qty)}</td><td>${esc(b.desc)}</td><td>${esc(b.unit)}</td><td>${esc(b.amount)}</td></tr>`);
      continue;
    }
    flush();
    if (b.k === 'center') body.push(`<p class="c${b.bold ? ' b' : ''}${b.big ? ' big' : ''}">${esc(b.text)}</p>`);
    else if (b.k === 'text') body.push(`<p${b.bold ? ' class="b"' : ''}>${esc(b.text)}</p>`);
    else if (b.k === 'pair') body.push(`<div class="pair${b.bold ? ' b' : ''}"><span>${esc(b.l)}</span><span>${esc(b.r)}</span></div>`);
    else if (b.k === 'rule') body.push(b.ch === '=' ? '<hr class="heavy">' : '<hr>');
    else if (b.k === 'sig') body.push(`<div class="sig">${esc(b.label)}</div>`);
    else if (b.k === 'qr') body.push(`<figure class="qr">${renderSVG(b.data, { ecc: 'M', border: 1 })}<figcaption>Validation seal</figcaption></figure>`);
  }
  flush();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: A4; margin: 16mm; }
body { font: 10.5pt/1.45 system-ui, sans-serif; color: #111; max-width: 178mm; margin: 0 auto; font-variant-numeric: tabular-nums; }
p { margin: 0; } .c { text-align: center; } .b { font-weight: 700; } .big { font-size: 15pt; letter-spacing: .04em; margin: 4pt 0; }
.pair { display: flex; justify-content: space-between; gap: 12pt; }
hr { border: 0; border-top: 1px solid #999; margin: 6pt 0; } hr.heavy { border-top: 2px solid #111; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0; } th, td { padding: 3pt 4pt; border-bottom: 1px solid #ddd; text-align: left; }
th:nth-child(n+3), td:nth-child(n+3) { text-align: right; } th:first-child, td:first-child { width: 12%; }
.sig { margin-top: 18pt; border-top: 1px solid #111; width: 60mm; padding-top: 2pt; }
.qr { width: 32mm; margin: 6pt auto; text-align: center; } .qr svg { width: 100%; height: auto; } figcaption { font-size: 8pt; }
</style></head><body>
${body.join('\n')}
</body></html>
`;
}
