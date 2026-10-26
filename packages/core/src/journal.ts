import { peso } from './util.ts';

// Phase 1 e-journal text. Phase 2 replaces this with the real invoice/report layouts
// (58mm, 80mm, A4); the journal always stores exactly what was issued, tagged by layout_version.
export const LAYOUT_VERSION = 'p1-plain';
const W = 40;

const row = (label: string, value = '') => label.slice(0, W - value.length - 1).padEnd(W - value.length) + value;
const rule = (c = '-') => c.repeat(W);

export const SUPPLEMENTARY_FOOTER = 'THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.';
export const DEMO_WATERMARK = 'DEMO, NOT FOR LIVE USE, NOT A VALID INVOICE';

export interface RenderHead {
  coreVersion: string;
  docType: string;
  number: string; // padded
  resetCounter: number;
  issuedAt: string;
  businessDate: string;
  terminal: { terminal_id: string; min: string | null; sln: string | null; mode: string };
  offline: boolean;
  reverses?: string; // e.g. "INVOICE 00000012"
}

// Body shape varies by document type; render whatever is present.
export function renderPlain(h: RenderHead, b: any): string {
  const out: string[] = [rule('=')];
  if (h.terminal.mode === 'DEMO') out.push(DEMO_WATERMARK);
  out.push(`Monset POS Core v${h.coreVersion}`, row(h.docType === 'INVOICE' ? 'Invoice' : h.docType, `No. ${h.number}`));
  if (h.resetCounter) out.push(row('Reset counter', String(h.resetCounter)));
  out.push(row('Issued', h.issuedAt), row('Business date', h.businessDate));
  out.push(row(`Terminal ${h.terminal.terminal_id}`, `MIN ${h.terminal.min ?? '[TO BE ISSUED]'}`), row('SLN', h.terminal.sln ?? '[TO BE ISSUED]'));
  if (h.reverses) out.push(row('Reverses', h.reverses), row('Reason', String(b.reason ?? '')));
  out.push(rule());

  for (const l of b.lines ?? []) {
    out.push(l.description);
    out.push(row(`  ${(l.qtyMilli / 1000).toFixed(3)} x ${l.unitPrice != null ? peso(l.unitPrice) : ''}`, peso(l.gross)));
    if (l.discount) out.push(row('  less discount', `-${peso(l.discount)}`));
  }
  const t = b.totals ?? b.sales;
  if (t) {
    out.push(rule());
    out.push(row('Gross', peso(t.gross)), row('Discount', `-${peso(t.discount)}`));
    for (const [k, v] of Object.entries(t.discounts ?? {})) out.push(row(`  ${k}`, `-${peso(v as number)}`));
    out.push(row(b.sales ? 'Net of discounts' : 'Amount due', peso(t.net)));
    out.push(row('VATable sales', peso(t.vatable)), row('VAT', peso(t.vat)), row('VAT-exempt sales', peso(t.exempt)), row('Zero-rated sales', peso(t.zeroRated)));
    if (t.nonVatTaxable) out.push(row('Sales subject to percentage tax', peso(t.nonVatTaxable)));
  }
  for (const p of b.payments && !b.sales ? b.payments : []) out.push(row(p.method, peso(p.amount)));
  if (b.change) out.push(row('Change', peso(b.change)));
  for (const p of Array.isArray(b.refunds) ? b.refunds : []) out.push(row(`Refunded ${p.method}`, peso(p.amount)));

  if (b.sales) {
    out.push(rule());
    out.push(row('Invoices', `${b.beginInvoiceNo ?? '-'} to ${b.endInvoiceNo ?? '-'}`), row('Invoice count', String(b.invoiceCount)));
    out.push(row('Beginning grand total', peso(b.beginGrandTotal)), row('Ending grand total', peso(b.endGrandTotal)));
    out.push(row('Reset counter', String(b.endResetCounter)), row('Z counter', String(b.zCounter)));
    for (const k of ['voids', 'refunds', 'returns']) out.push(row(`${k} (${b[k].count})`, `-${peso(b[k].amount)}`));
    out.push(row('Net sales', peso(b.netSales)));
    for (const [m, v] of Object.entries(b.payments)) out.push(row(`  ${m}`, peso(v as number)));
  }

  if (h.offline) out.push('[ISSUED OFFLINE]');
  if (!['INVOICE', 'X', 'Z'].includes(h.docType)) out.push(SUPPLEMENTARY_FOOTER);
  if (h.terminal.mode === 'DEMO') out.push(DEMO_WATERMARK);
  return out.join('\n');
}
