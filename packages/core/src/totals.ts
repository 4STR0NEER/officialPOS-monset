import { CoreError, isCentavos, mulDiv } from './util.ts';

// Phase 1 scope: VAT classes, VAT modes and plain per-line discounts.
// Special discounts (SC/PWD/NAAC/Solo Parent, VAT-exempt order of operations) arrive in Phase 2.

export type VatClass = 'VATABLE' | 'EXEMPT' | 'ZERO';
export type VatMode = 'VAT' | 'NONVAT' | 'EXEMPT';

export interface SaleLine {
  sku?: string;
  description: string;
  qtyMilli: number; // 1 unit = 1000; weighed items use thousandths
  unitPrice: number; // centavos, VAT-inclusive for VATABLE lines
  vatClass: VatClass;
  discounts?: { type: string; amount: number }[];
}

export interface PricedLine extends SaleLine {
  lineNo: number;
  gross: number;
  discount: number;
  net: number;
}

export interface Totals {
  gross: number; // before discounts
  discount: number;
  discounts: Record<string, number>;
  net: number; // amount due
  vatable: number; // VATable sales, VAT excluded
  vat: number;
  exempt: number;
  zeroRated: number;
  nonVatTaxable: number; // NONVAT sellers: sales subject to percentage tax
}

export const emptyTotals = (): Totals => ({
  gross: 0, discount: 0, discounts: {}, net: 0, vatable: 0, vat: 0, exempt: 0, zeroRated: 0, nonVatTaxable: 0,
});

/** Split net amounts per VAT class into the invoice/reading buckets. */
export function splitByClass(
  netByClass: Record<VatClass, number>,
  vatMode: VatMode,
  vatRateBp: number,
): Pick<Totals, 'vatable' | 'vat' | 'exempt' | 'zeroRated' | 'nonVatTaxable'> {
  if (vatMode === 'EXEMPT') {
    return { vatable: 0, vat: 0, exempt: netByClass.VATABLE + netByClass.EXEMPT + netByClass.ZERO, zeroRated: 0, nonVatTaxable: 0 };
  }
  if (vatMode === 'NONVAT') {
    return { vatable: 0, vat: 0, exempt: netByClass.EXEMPT, zeroRated: 0, nonVatTaxable: netByClass.VATABLE };
  }
  const vatable = mulDiv(netByClass.VATABLE, 10_000, 10_000 + vatRateBp);
  return { vatable, vat: netByClass.VATABLE - vatable, exempt: netByClass.EXEMPT, zeroRated: netByClass.ZERO, nonVatTaxable: 0 };
}

export function priceSale(lines: SaleLine[], vatMode: VatMode, vatRateBp: number): { lines: PricedLine[]; totals: Totals } {
  if (!Array.isArray(lines) || lines.length === 0) throw new CoreError('BAD_SALE', 'a sale needs at least one line');
  const t = emptyTotals();
  const netByClass: Record<VatClass, number> = { VATABLE: 0, EXEMPT: 0, ZERO: 0 };
  const priced = lines.map((l, i): PricedLine => {
    if (!l.description) throw new CoreError('BAD_SALE', `line ${i + 1}: description required`);
    if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0) throw new CoreError('BAD_SALE', `line ${i + 1}: quantity must be positive`);
    if (!isCentavos(l.unitPrice)) throw new CoreError('BAD_SALE', `line ${i + 1}: unit price must be whole centavos`);
    if (!['VATABLE', 'EXEMPT', 'ZERO'].includes(l.vatClass)) throw new CoreError('BAD_SALE', `line ${i + 1}: unknown VAT class`);
    if (l.vatClass === 'ZERO' && vatMode !== 'VAT') throw new CoreError('BAD_SALE', `line ${i + 1}: only VAT-registered sellers can zero-rate`);
    const gross = mulDiv(l.qtyMilli, l.unitPrice, 1000);
    let discount = 0;
    for (const d of l.discounts ?? []) {
      if (!d.type || !isCentavos(d.amount)) throw new CoreError('BAD_SALE', `line ${i + 1}: bad discount`);
      discount += d.amount;
      t.discounts[d.type] = (t.discounts[d.type] ?? 0) + d.amount;
    }
    if (discount > gross) throw new CoreError('BAD_SALE', `line ${i + 1}: discount exceeds line amount`);
    const net = gross - discount;
    t.gross += gross;
    t.discount += discount;
    t.net += net;
    netByClass[l.vatClass] += net;
    return { ...l, lineNo: i + 1, gross, discount, net };
  });
  return { lines: priced, totals: { ...t, ...splitByClass(netByClass, vatMode, vatRateBp) } };
}

export interface Payment {
  method: string; // CASH, CARD, QRPH, GCASH, ... (providers are plug-ins later)
  amount: number;
  ref?: string;
}

/** Tendered must cover the amount due; change only comes out of cash. */
export function settle(payments: Payment[], due: number): { tendered: number; change: number } {
  if (!Array.isArray(payments) || payments.length === 0) throw new CoreError('BAD_PAYMENT', 'no payment given');
  let tendered = 0;
  let cash = 0;
  for (const p of payments) {
    if (!p.method || !isCentavos(p.amount) || p.amount === 0) throw new CoreError('BAD_PAYMENT', 'each payment needs a method and a positive amount');
    tendered += p.amount;
    if (p.method === 'CASH') cash += p.amount;
  }
  if (tendered < due) throw new CoreError('BAD_PAYMENT', 'payment is short of the amount due');
  const change = tendered - due;
  if (change > cash) throw new CoreError('BAD_PAYMENT', 'non-cash payments cannot exceed the amount due');
  return { tendered, change };
}
