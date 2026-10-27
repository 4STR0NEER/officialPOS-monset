import { CoreError, isCentavos, mulDiv } from './util.ts';

export type VatClass = 'VATABLE' | 'EXEMPT' | 'ZERO';
export type VatMode = 'VAT' | 'NONVAT' | 'EXEMPT';

export interface SaleLine {
  sku?: string;
  description: string;
  qtyMilli: number; // 1 unit = 1000; weighed items use thousandths
  unitPrice: number; // centavos, VAT-inclusive for VATABLE lines
  vatClass: VatClass;
  category?: string; // matched against a special discount type's eligible categories
  discounts?: { type: string; amount: number }[]; // regular discounts (promos, vouchers)
}

export interface PricedLine extends SaleLine {
  lineNo: number;
  gross: number;
  discount: number; // every discount actually applied (regular + special), VAT exemption excluded
  discountsByType: Record<string, number>;
  vatExemption: number;
  net: number; // gross - discount - vatExemption
  netByClass: Partial<Record<VatClass, number>>; // a senior's share of a VATable line becomes VAT-exempt
}

export interface Totals {
  gross: number; // before discounts
  discount: number;
  discounts: Record<string, number>; // by type: PROMO..., SC, PWD, NAAC, SOLO...
  vatExemption: number; // VAT removed for special-discount holders
  net: number; // amount due
  vatable: number; // VATable sales, VAT excluded
  vat: number;
  exempt: number;
  zeroRated: number;
  nonVatTaxable: number; // NONVAT sellers: sales subject to percentage tax
}

export const emptyTotals = (): Totals => ({
  gross: 0, discount: 0, discounts: {}, vatExemption: 0, net: 0, vatable: 0, vat: 0, exempt: 0, zeroRated: 0, nonVatTaxable: 0,
});

/** A special discount type, stored as data in rule_set (kind DISCOUNT_TYPE:<code>). */
export interface DiscountRule {
  code: string;
  label: string;
  rateBp: number; // 2000 = 20%
  vatExempt: boolean; // remove VAT before applying the discount
  categories: string[] | null; // null = every item qualifies
  idTypes: string[];
  requireTin: boolean;
}

export interface SpecialDiscountInput {
  type: string;
  holder: { name: string; idNo: string; idType?: string; tin?: string };
  channel?: 'IN_STORE' | 'ONLINE'; // ONLINE: no signature line (RR 8-2023)
  items?: { lineNo: number; qtyMilli: number }[]; // the holder's own items
  diners?: number; // group meal: the holder's share is 1/diners of every eligible line
}

export interface SpecialDiscount {
  type: string;
  label: string;
  rateBp: number;
  vatExempt: boolean;
  holder: { name: string; idNo: string; idType: string | null; tin: string | null };
  channel: 'IN_STORE' | 'ONLINE';
  basis: 'ITEMS' | 'GROUP_SHARE';
  diners: number | null;
  coveredGross: number;
  vatExemption: number;
  discount: number;
  net: number; // what the holder's share costs after exemption and discount
}

/** Split net amounts per VAT class into the invoice/reading buckets. */
export function splitByClass(
  netByClass: Partial<Record<VatClass, number>>,
  vatMode: VatMode,
  vatRateBp: number,
): Pick<Totals, 'vatable' | 'vat' | 'exempt' | 'zeroRated' | 'nonVatTaxable'> {
  const v = netByClass.VATABLE ?? 0;
  const e = netByClass.EXEMPT ?? 0;
  const z = netByClass.ZERO ?? 0;
  if (vatMode === 'EXEMPT') return { vatable: 0, vat: 0, exempt: v + e + z, zeroRated: 0, nonVatTaxable: 0 };
  if (vatMode === 'NONVAT') return { vatable: 0, vat: 0, exempt: e, zeroRated: 0, nonVatTaxable: v };
  const vatable = mulDiv(v, 10_000, 10_000 + vatRateBp);
  return { vatable, vat: v - vatable, exempt: e, zeroRated: z, nonVatTaxable: 0 };
}

/** Exact fraction p/q of an amount, half-up. */
const part = (amount: number, p: bigint, q: bigint) => {
  const n = BigInt(amount) * p;
  return Number((2n * (n % q) >= q ? 1n : 0n) + n / q);
};

/** Share `total` across weights, remainder to the last non-zero weight, so parts always sum to total. */
export function apportion(total: number, weights: Record<string, number>): Record<string, number> {
  const keys = Object.keys(weights).filter((k) => weights[k] > 0);
  const sum = keys.reduce((a, k) => a + weights[k], 0);
  const out: Record<string, number> = {};
  let given = 0;
  keys.forEach((k, i) => {
    out[k] = i === keys.length - 1 ? total - given : mulDiv(total, weights[k], sum);
    given += out[k];
  });
  return out;
}

const addTo = (m: Record<string, number>, k: string, v: number) => {
  if (v) m[k] = (m[k] ?? 0) + v;
};

/**
 * Price a sale. Special discounts follow the order of operations the law expects:
 * take VAT out of the holder's share first, then apply the discount to the VAT-free amount.
 * A promo and a special discount never stack on the same share: the larger benefit wins.
 */
export function priceSale(
  lines: SaleLine[],
  vatMode: VatMode,
  vatRateBp: number,
  specials: SpecialDiscountInput[] = [],
  ruleFor: (code: string) => DiscountRule | undefined = () => undefined,
): { lines: PricedLine[]; totals: Totals; specialDiscounts: SpecialDiscount[] } {
  if (!Array.isArray(lines) || lines.length === 0) throw new CoreError('BAD_SALE', 'a sale needs at least one line');
  const base = lines.map((l, i) => {
    if (!l.description) throw new CoreError('BAD_SALE', `line ${i + 1}: description required`);
    if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0) throw new CoreError('BAD_SALE', `line ${i + 1}: quantity must be positive`);
    if (!isCentavos(l.unitPrice)) throw new CoreError('BAD_SALE', `line ${i + 1}: unit price must be whole centavos`);
    if (!['VATABLE', 'EXEMPT', 'ZERO'].includes(l.vatClass)) throw new CoreError('BAD_SALE', `line ${i + 1}: unknown VAT class`);
    if (l.vatClass === 'ZERO' && vatMode !== 'VAT') throw new CoreError('BAD_SALE', `line ${i + 1}: only VAT-registered sellers can zero-rate`);
    const gross = mulDiv(l.qtyMilli, l.unitPrice, 1000);
    const promo: Record<string, number> = {};
    for (const d of l.discounts ?? []) {
      if (!d.type || !isCentavos(d.amount)) throw new CoreError('BAD_SALE', `line ${i + 1}: bad discount`);
      addTo(promo, d.type, d.amount);
    }
    const promoTotal = Object.values(promo).reduce((a, v) => a + v, 0);
    if (promoTotal > gross) throw new CoreError('BAD_SALE', `line ${i + 1}: discount exceeds line amount`);
    return { l, gross, promo, promoTotal, cover: [] as { h: number; p: bigint; q: bigint }[] };
  });

  // Who covers which share of which line.
  const rules: DiscountRule[] = [];
  const seen = new Set<string>();
  specials.forEach((s, h) => {
    const rule = ruleFor(s.type);
    if (!rule) throw new CoreError('BAD_DISCOUNT', `unknown special discount type ${s.type}`);
    rules.push(rule);
    if (!s.holder?.name?.trim() || !s.holder?.idNo?.trim()) throw new CoreError('BAD_DISCOUNT', `${rule.label}: name and ID number are required`);
    if (s.holder.idType && !rule.idTypes.includes(s.holder.idType)) throw new CoreError('BAD_DISCOUNT', `${rule.label}: ${s.holder.idType} is not an accepted ID`);
    if (rule.requireTin && !s.holder.tin) throw new CoreError('BAD_DISCOUNT', `${rule.label}: TIN is required`);
    const key = `${rule.code}|${s.holder.idNo.trim().toUpperCase()}`;
    if (seen.has(key)) throw new CoreError('DOUBLE_DISCOUNT', `${rule.label} ${s.holder.idNo} is already applied to this sale`);
    seen.add(key);
    const eligible = (i: number) => rule.categories === null || rule.categories.includes(base[i].l.category ?? '');
    if (!!s.items === !!s.diners) throw new CoreError('BAD_DISCOUNT', `${rule.label}: give either the holder's items or the number of diners`);
    let covered = 0;
    if (s.items) {
      for (const it of s.items) {
        const i = it.lineNo - 1;
        if (!base[i]) throw new CoreError('BAD_DISCOUNT', `no line ${it.lineNo}`);
        if (!eligible(i)) throw new CoreError('NOT_ELIGIBLE', `${rule.label} does not cover ${base[i].l.description}`);
        if (!Number.isSafeInteger(it.qtyMilli) || it.qtyMilli <= 0) throw new CoreError('BAD_DISCOUNT', 'covered quantity must be positive');
        base[i].cover.push({ h, p: BigInt(it.qtyMilli), q: BigInt(base[i].l.qtyMilli) });
        covered++;
      }
    } else {
      if (!Number.isSafeInteger(s.diners) || s.diners! < 1) throw new CoreError('BAD_DISCOUNT', 'number of diners must be a whole number');
      base.forEach((b, i) => {
        if (eligible(i)) {
          b.cover.push({ h, p: 1n, q: BigInt(s.diners!) });
          covered++;
        }
      });
    }
    if (!covered) throw new CoreError('NOT_ELIGIBLE', `${rule.label}: nothing in this sale qualifies`);
  });

  const out: SpecialDiscount[] = specials.map((s, h) => ({
    type: rules[h].code, label: rules[h].label, rateBp: rules[h].rateBp, vatExempt: rules[h].vatExempt,
    holder: { name: s.holder.name.trim(), idNo: s.holder.idNo.trim(), idType: s.holder.idType ?? null, tin: s.holder.tin ?? null },
    channel: s.channel ?? 'IN_STORE', basis: s.items ? 'ITEMS' : 'GROUP_SHARE', diners: s.diners ?? null,
    coveredGross: 0, vatExemption: 0, discount: 0, net: 0,
  }));

  const t = emptyTotals();
  const netByClass: Partial<Record<VatClass, number>> = {};
  const priced = base.map(({ l, gross, promo, promoTotal, cover }, i): PricedLine => {
    // cumulative shares so the parts of a line never exceed the line
    let P = 0n;
    let Q = 1n;
    let gDone = 0;
    let pDone = 0;
    let promoKept = 0;
    let special = 0;
    let vatEx = 0;
    const byType: Record<string, number> = {};
    const classes: Partial<Record<VatClass, number>> = {};
    for (const c of cover) {
      P = P * c.q + c.p * Q;
      Q = Q * c.q;
      if (P > Q) throw new CoreError('OVER_COVERED', `line ${i + 1}: more than the whole line is claimed for discounts`);
      const g = part(gross, P, Q) - gDone;
      const pr = part(promoTotal, P, Q) - pDone;
      gDone += g;
      pDone += pr;
      const rule = rules[c.h];
      const vatApplies = vatMode === 'VAT' && l.vatClass === 'VATABLE';
      const exVat = rule.vatExempt && vatApplies ? mulDiv(g, 10_000, 10_000 + vatRateBp) : g;
      const ex = g - exVat;
      const disc = mulDiv(exVat, rule.rateBp, 10_000);
      if (pr > ex + disc) {
        promoKept += pr; // the promo is worth more on this share; no special discount here
        addTo(classes, l.vatClass, g - pr);
        continue;
      }
      vatEx += ex;
      special += disc;
      addTo(byType, rule.code, disc);
      addTo(classes, ex > 0 ? 'EXEMPT' : l.vatClass, exVat - disc);
      const o = out[c.h];
      o.coveredGross += g;
      o.vatExemption += ex;
      o.discount += disc;
      o.net += exVat - disc;
    }
    const restPromo = promoTotal - pDone;
    promoKept += restPromo;
    addTo(classes, l.vatClass, gross - gDone - restPromo);
    for (const [k, v] of Object.entries(apportion(promoKept, promo))) addTo(byType, k, v);

    const discount = promoKept + special;
    const net = gross - discount - vatEx;
    t.gross += gross;
    t.discount += discount;
    t.vatExemption += vatEx;
    t.net += net;
    for (const [k, v] of Object.entries(byType)) addTo(t.discounts, k, v);
    for (const [k, v] of Object.entries(classes)) addTo(netByClass, k, v);
    return { ...l, lineNo: i + 1, gross, discount, discountsByType: byType, vatExemption: vatEx, net, netByClass: classes };
  });
  return { lines: priced, totals: { ...t, ...splitByClass(netByClass, vatMode, vatRateBp) }, specialDiscounts: out };
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
