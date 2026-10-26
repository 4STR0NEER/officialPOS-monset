import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CoreError, GRAND_TOTAL_MAX, priceSale, type EntryRow, type Reading, type SaleLine } from '@monset/core';
import { make } from './helpers.ts';

const lineArb: fc.Arbitrary<SaleLine> = fc.record({
  description: fc.constantFrom('Adobo', 'Rice', 'Coffee', 'Bread'),
  qtyMilli: fc.integer({ min: 1, max: 5000 }),
  unitPrice: fc.integer({ min: 0, max: 200_000 }),
  vatClass: fc.constantFrom('VATABLE', 'VATABLE', 'EXEMPT', 'ZERO'),
});

const cmdArb = fc.oneof(
  { weight: 6, arbitrary: fc.record({ op: fc.constant('sale' as const), lines: fc.array(lineArb, { minLength: 1, maxLength: 4 }), extra: fc.nat(5000), card: fc.boolean(), discount: fc.nat(500), offline: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant('void' as const), pick: fc.nat() }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constantFrom('refund' as const, 'return' as const), pick: fc.nat(), lineNo: fc.integer({ min: 1, max: 2 }), qty: fc.integer({ min: 1, max: 1500 }) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constantFrom('x' as const, 'z' as const) }) },
);

/** Run a random day sequence; expected refusals (CoreError) are fine, anything else fails the property. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cmd = { op: string } & Record<string, any>;
function run(cmds: Cmd[]) {
  const t = make();
  const invoices: number[] = [];
  const gtSeen: number[] = [];
  for (const c of cmds) {
    try {
      if (c.op === 'sale') {
        const lines = (c.lines as SaleLine[]).map((l, i) => (i === 0 && c.discount ? { ...l, discounts: [{ type: 'PROMO', amount: Math.min(c.discount, Math.round((l.qtyMilli * l.unitPrice) / 1000)) }] } : l));
        const due = priceSale(lines, 'VAT', 1200).totals.net;
        const payments = c.card ? [{ method: 'CARD', amount: due }] : [{ method: 'CASH', amount: due + c.extra }];
        if (due === 0 && c.card) continue;
        if (due + (c.card ? 0 : c.extra) === 0) continue;
        invoices.push(t.pos.postSale({ userId: 'c1', online: !c.offline, lines, payments }).seq);
      } else if (c.op === 'void' && invoices.length) {
        t.pos.postReversal({ userId: 'c1', online: true, type: 'VOID', invoiceSeq: invoices[c.pick % invoices.length], reason: 'p' });
      } else if ((c.op === 'refund' || c.op === 'return') && invoices.length) {
        t.pos.postReversal({ userId: 'c1', online: true, type: c.op === 'refund' ? 'REFUND' : 'RETURN', invoiceSeq: invoices[c.pick % invoices.length], reason: 'p', lines: [{ lineNo: c.lineNo, qtyMilli: c.qty }] });
      } else if (c.op === 'x') t.pos.xReading('s1');
      else if (c.op === 'z') t.pos.zReading('s1');
    } catch (e) {
      if (!(e instanceof CoreError)) throw e;
    }
    const a = t.pos.state().accumulators;
    gtSeen.push(a.reset_counter * (GRAND_TOTAL_MAX + 1) + a.grand_total);
  }
  t.pos.zReading('s1');
  return { ...t, gtSeen };
}

const ledger = (db: ReturnType<typeof make>['db']) =>
  db.all<EntryRow>(`SELECT * FROM ledger_entry ORDER BY seq`).map((r) => ({ ...r, b: JSON.parse(r.body) }));

describe('compliance core invariants (property-based)', () => {
  const days = fc.array(cmdArb, { minLength: 1, maxLength: 60 });

  it('P-B1-gt-monotonic: the grand total never decreases', () => {
    fc.assert(fc.property(days, (cmds) => {
      const { gtSeen } = run(cmds);
      for (let i = 1; i < gtSeen.length; i++) expect(gtSeen[i]).toBeGreaterThanOrEqual(gtSeen[i - 1]);
    }), { numRuns: 150 });
  });

  it('P-B8-gapless + P-B2-reversal-refs-original: numbers are gapless and every reversal points at an earlier invoice', () => {
    const seen = new Map<string, number>();
    fc.assert(fc.property(days, (cmds) => {
      const { db, pos } = run(cmds);
      for (const r of ledger(db)) seen.set(r.doc_type, (seen.get(r.doc_type) ?? 0) + 1);
      expect(pos.verify().issues).toEqual([]);
      const rows = ledger(db);
      expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i + 1));
      const byType = new Map<string, number[]>();
      for (const r of rows) byType.set(r.doc_type, [...(byType.get(r.doc_type) ?? []), r.doc_no]);
      for (const nos of byType.values()) expect(nos).toEqual(nos.map((_, i) => i + 1));
      for (const r of rows.filter((x) => ['VOID', 'REFUND', 'RETURN'].includes(x.doc_type))) {
        const orig = rows.find((o) => o.seq === r.reverses_seq);
        expect(orig?.doc_type).toBe('INVOICE');
        expect(orig!.seq).toBeLessThan(r.seq);
      }
    }), { numRuns: 150 });
    // guard against a vacuous property: the generator must actually exercise every document type
    for (const t of ['INVOICE', 'VOID', 'REFUND', 'RETURN', 'X', 'Z']) expect(seen.get(t) ?? 0).toBeGreaterThan(5);
  });

  it('P-B6-z-reconciles-ledger: every Z equals an independent sum of the ledger it covers', () => {
    fc.assert(fc.property(days, (cmds) => {
      const { db } = run(cmds);
      const rows = ledger(db);
      let from = 1;
      let gt = 0;
      for (const z of rows.filter((r) => r.doc_type === 'Z')) {
        const span = rows.filter((r) => r.seq >= from && r.seq < z.seq);
        const inv = span.filter((r) => r.doc_type === 'INVOICE');
        const rev = (t: string) => span.filter((r) => r.doc_type === t).reduce((a, r) => a + r.b.totals.net, 0);
        const sum = (k: string) => inv.reduce((a, r) => a + r.b.totals[k], 0);
        const zb = z.b as Reading;
        expect(zb.sales.gross).toBe(sum('gross'));
        expect(zb.sales.net).toBe(sum('net'));
        expect(zb.sales.vatable + zb.sales.vat + zb.sales.exempt + zb.sales.zeroRated).toBe(sum('net'));
        expect(zb.voids.amount).toBe(rev('VOID'));
        expect(zb.refunds.amount).toBe(rev('REFUND'));
        expect(zb.returns.amount).toBe(rev('RETURN'));
        expect(zb.netSales).toBe(sum('net') - rev('VOID') - rev('REFUND') - rev('RETURN'));
        expect(Object.values(zb.payments).reduce((a, v) => a + v, 0)).toBe(zb.netSales);
        expect(zb.beginGrandTotal).toBe(gt);
        expect(zb.endGrandTotal - zb.beginGrandTotal).toBe(zb.sales.gross);
        expect(zb.invoiceCount).toBe(inv.length);
        gt = zb.endGrandTotal;
        from = z.seq + 1;
      }
    }), { numRuns: 150 });
  });

  it('P-B2-reversals-bounded: no line is ever reversed beyond what was sold', () => {
    fc.assert(fc.property(days, (cmds) => {
      const { db } = run(cmds);
      const rows = ledger(db);
      for (const inv of rows.filter((r) => r.doc_type === 'INVOICE')) {
        const revs = rows.filter((r) => r.reverses_seq === inv.seq);
        for (const l of inv.b.lines) {
          const back = revs.flatMap((r) => r.b.lines).filter((x: { lineNo: number }) => x.lineNo === l.lineNo);
          expect(back.reduce((a: number, x: { qtyMilli: number }) => a + x.qtyMilli, 0)).toBeLessThanOrEqual(l.qtyMilli);
          expect(back.reduce((a: number, x: { net: number }) => a + x.net, 0)).toBeLessThanOrEqual(l.net);
          for (const x of back) expect(x.net).toBeGreaterThanOrEqual(0);
        }
      }
    }), { numRuns: 150 });
  });
});
