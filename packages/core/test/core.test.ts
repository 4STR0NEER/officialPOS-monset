import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addGrandTotal, CORE_VERSION, CoreError, GRAND_TOTAL_MAX, openCore, priceSale, settle, SUPPLEMENTARY_FOOTER, DEMO_WATERMARK } from '@monset/core';
import { cash, flat, line, make } from './helpers.ts';

const SRC = join(import.meta.dirname, '../src');
const coreSource = () => readdirSync(SRC).map((f) => readFileSync(join(SRC, f), 'utf8')).join('\n');
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as CoreError).code ?? (e as Error).message;
  }
  return 'no error';
};
const actions = (db: ReturnType<typeof make>['db']) => db.all<{ action: string; object: string | null }>(`SELECT action, object FROM activity_log ORDER BY id`);

describe('A: architectural constraints', () => {
  it('T-A1-no-remote-sor: the core has no network client of any kind', () => {
    expect(coreSource()).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|https?:\/\//);
  });

  it('T-A2-offline-flags: offline sales carry offline, device and time flags; sync time is recorded separately', () => {
    const { db, pos } = make();
    const s = pos.postSale({ userId: 'c1', online: false, lines: [line(1000)], payments: cash(1000) });
    const row = db.get<{ created_offline: number; device_id: string; issued_at: string }>(`SELECT * FROM ledger_entry WHERE seq = ?`, s.seq)!;
    expect(row).toMatchObject({ created_offline: 1, device_id: 'DEV-1' });
    expect(row.issued_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(s.text).toContain('[ISSUED OFFLINE]');
    expect(db.get(`SELECT acked_at FROM outbox WHERE seq = ?`, s.seq)).toMatchObject({ acked_at: null });
    pos.markSynced('hub', s.seq);
    expect(db.get<{ acked_at: string }>(`SELECT acked_at FROM outbox WHERE seq = ?`, s.seq)!.acked_at).toBeTruthy();
    expect(pos.verify().ok).toBe(true); // acking a sync is not a ledger edit
  });

  it('T-A3-core-version: one version, stamped on every entry and every journal document', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '../package.json'), 'utf8'));
    expect(CORE_VERSION).toBe(pkg.version);
    const { db, pos } = make();
    pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    pos.zReading('s1');
    for (const r of db.all<{ core_version: string }>(`SELECT core_version FROM ledger_entry`)) expect(r.core_version).toBe(CORE_VERSION);
    for (const r of db.all<{ text: string }>(`SELECT text FROM journal`)) expect(r.text).toContain(`Core v${CORE_VERSION}`);
  });

  it('T-A4-core-never-reads-tier: the core has no notion of tiers or feature flags', () => {
    expect(coreSource()).not.toMatch(/\btier\b|\bfeatures?\b|hasFeature/i);
  });

  it('T-A5-nonInvoicing-blocks-invoice: an ordering-only install cannot issue an invoice, and the attempt is logged', () => {
    const { db, pos } = make({ mode: 'NON_INVOICING' });
    expect(code(() => pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) }))).toBe('NON_INVOICING');
    expect(db.get(`SELECT count(*) AS n FROM ledger_entry`)).toMatchObject({ n: 0 });
    expect(actions(db).at(-1)).toMatchObject({ action: 'REJECTED', object: 'POST_SALE' });
  });

  it('T-A7-no-mode-switch-api: mode and identity are fixed for the life of the install', () => {
    const { db, pos } = make();
    expect(code(() => pos.updateTerminal('owner', { mode: 'DEMO' } as never))).toBe('BAD_SETTING');
    expect(() => db.run(`UPDATE terminal SET mode = 'NON_INVOICING'`)).toThrow(/fixed/);
    expect(() => db.run(`UPDATE terminal SET device_id = 'other'`)).toThrow(/fixed/);
    expect(() => db.run(`DELETE FROM terminal`)).toThrow();
    expect(code(() => pos.initTerminal('owner', { terminalId: 'T2', deviceId: 'D', mode: 'LIVE', vatMode: 'VAT' }))).toBe('TERMINAL_EXISTS');
  });

  it('T-A7-demo-watermark: every demo document is watermarked', () => {
    const { db, pos } = make({ mode: 'DEMO' });
    const s = pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    pos.postReversal({ userId: 'c1', online: true, type: 'VOID', invoiceSeq: s.seq, reason: 'test' });
    pos.xReading('s1');
    for (const r of db.all<{ text: string }>(`SELECT text FROM journal`)) expect(flat(r.text)).toContain(DEMO_WATERMARK);
  });
});

describe('B: compliance core (RMO 24-2023 IV(5))', () => {
  it('T-B1-rollover-increments-reset: the grand total wraps past 999,999,999,999.99 and bumps the reset counter', () => {
    expect(addGrandTotal(GRAND_TOTAL_MAX - 100, 0, 500)).toEqual({ gt: 399, reset: 1 });
    expect(addGrandTotal(GRAND_TOTAL_MAX, 2, 1)).toEqual({ gt: 0, reset: 3 });
    expect(addGrandTotal(5, 0, 0)).toEqual({ gt: 5, reset: 0 });
    const { db, pos } = make();
    db.run(`UPDATE accumulator SET grand_total = ?`, GRAND_TOTAL_MAX - 100); // forward moves are allowed by the trigger...
    pos.postSale({ userId: 'c1', online: true, lines: [line(500)], payments: cash(500) });
    expect(pos.state().accumulators).toMatchObject({ grand_total: 399, reset_counter: 1 });
    expect(pos.verify().open.map((i) => i.kind)).toContain('ACCUMULATOR'); // ...but the ledger exposes the jump
  });

  it('T-B1-gt-cannot-decrease: the database refuses to lower any accumulator', () => {
    const { db, pos } = make();
    pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    expect(() => db.run(`UPDATE accumulator SET grand_total = 0`)).toThrow(/never decrease/);
    expect(() => db.run(`UPDATE accumulator SET z_counter = -1`)).toThrow(/never decrease/);
    expect(() => db.run(`DELETE FROM accumulator`)).toThrow();
  });

  it('T-B2-update/delete-trigger-aborts: posted rows cannot be edited or deleted', () => {
    const { db, pos } = make();
    pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    for (const t of ['ledger_entry', 'journal', 'activity_log', 'rule_set']) {
      expect(() => db.run(`UPDATE ${t} SET rowid = rowid`)).toThrow(/append-only/);
      expect(() => db.run(`DELETE FROM ${t}`)).toThrow(/append-only/);
    }
    expect(() => db.run(`UPDATE doc_series SET next_no = 1 WHERE doc_type = 'INVOICE'`)).toThrow(/forward/);
  });

  it('T-B2-chain-detects-edit: tampering locks issuing until a supervisor acknowledges it', () => {
    const { db, pos, clock } = make();
    const s = pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    pos.postSale({ userId: 'c1', online: true, lines: [line(2000)], payments: cash(2000) });
    db.exec(`DROP TRIGGER ledger_entry_no_update`); // someone opens the file with a SQLite tool
    db.run(`UPDATE ledger_entry SET body = replace(body, '1000', '10') WHERE seq = ?`, s.seq);

    const reopened = openCore(db, { now: clock.now });
    expect(reopened.state().locked).toBe(true);
    expect(reopened.verify().open).toEqual([
      expect.objectContaining({ kind: 'HASH', seq: s.seq }),
      expect.objectContaining({ kind: 'ACCUMULATOR', detail: 'grand_total differs from the ledger by 990' }),
    ]);
    expect(code(() => reopened.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) }))).toBe('LOCKED');
    expect(code(() => reopened.zReading('s1'))).toBe('LOCKED');

    reopened.acknowledgeIntegrity('sup1', 'Invoice 1 body altered outside the POS; reported to owner');
    expect(reopened.state().locked).toBe(false);
    reopened.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    expect(openCore(db, { now: clock.now }).state().locked).toBe(false); // the acknowledged break stays on record but does not relock
    expect(actions(db).map((a) => a.action)).toEqual(expect.arrayContaining(['INTEGRITY_BREAK', 'INTEGRITY_ACK']));
  });

  it('T-B3-each-action-logged: every action is in a hash-chained log with user, device, time and before/after', () => {
    const { db, pos } = make();
    pos.record('c1', 'LOGIN');
    const s = pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    pos.postReversal({ userId: 'c1', online: true, type: 'VOID', invoiceSeq: s.seq, reason: 'test' });
    code(() => pos.postReversal({ userId: 'c1', online: true, type: 'VOID', invoiceSeq: s.seq, reason: 'again' }));
    pos.updateTerminal('owner', { min: '123456789012345' });
    pos.addRule('owner', 'VAT_RATE', '2030-01-01', { rateBp: 1200 }, 'test');
    pos.xReading('s1');
    pos.zReading('s1');
    pos.exportJournal('owner');
    pos.markSynced('hub', 99);
    pos.record('owner', 'PERMISSION_CHANGE', 'c1', { role: 'cashier' }, { role: 'supervisor' });

    const log = db.all<{ action: string; user_id: string; device_id: string; at: string; before_json: string | null; after_json: string | null }>(`SELECT * FROM activity_log ORDER BY id`);
    expect(log.map((l) => l.action)).toEqual([
      'TERMINAL_INIT', 'SETTINGS_CHANGE', 'LOGIN', 'ISSUE', 'ISSUE', 'REJECTED', 'SETTINGS_CHANGE', 'RULE_ADD', 'ISSUE', 'ISSUE', 'EXPORT', 'TRANSMIT_ACK', 'PERMISSION_CHANGE',
    ]);
    for (const l of log) {
      expect(l.user_id).toBeTruthy();
      expect(l.device_id).toBe('DEV-1');
      expect(l.at).toMatch(/Z$/);
    }
    const settings = log.filter((l) => l.action === 'SETTINGS_CHANGE').at(-1)!;
    expect(JSON.parse(settings.before_json!).min).toBeNull();
    expect(JSON.parse(settings.after_json!).min).toBe('123456789012345');
    expect(pos.verify().ok).toBe(true);
  });

  it('T-B3-log-chain: editing the activity log is detected', () => {
    const { db, pos } = make();
    pos.record('c1', 'LOGIN');
    db.exec(`DROP TRIGGER activity_log_no_update`);
    db.run(`UPDATE activity_log SET user_id = 'someone-else' WHERE action = 'LOGIN'`);
    expect(pos.verify().open.map((i) => i.kind)).toEqual(['ACTIVITY']);
  });

  it('T-B5-journal-every-doc: every issued document has its e-journal text; export covers them all', () => {
    const { db, pos } = make();
    const s = pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    pos.postReversal({ userId: 'c1', online: true, type: 'REFUND', invoiceSeq: s.seq, reason: 'test', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    pos.xReading('s1');
    pos.zReading('s1');
    expect(db.get(`SELECT count(*) AS n FROM journal`)).toEqual(db.get(`SELECT count(*) AS n FROM ledger_entry`));
    const ej = pos.exportJournal('owner');
    for (const t of ['INVOICE', 'REFUND', 'X READING', 'Z READING']) expect(ej).toContain(t);
    expect(ej.match(/Monset POS Core v/g)).toHaveLength(4);
  });

  it('T-B5-supplementary-footer: reversal documents carry the input-tax footer; invoices do not', () => {
    const { pos } = make();
    const s = pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    expect(s.text).not.toContain(SUPPLEMENTARY_FOOTER);
    expect(s.text).not.toMatch(/official receipt/i);
    expect(flat(pos.postReversal({ userId: 'c1', online: true, type: 'VOID', invoiceSeq: s.seq, reason: 'x' }).text)).toContain(SUPPLEMENTARY_FOOTER);
  });

  it('T-B6-x-not-closing / z-counter-monotonic: X leaves the day open; Z closes it and counts up', () => {
    const { pos } = make();
    const s = pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    const x1 = pos.xReading('s1').reading;
    pos.postSale({ userId: 'c1', online: true, lines: [line(500)], payments: cash(500) });
    const x2 = pos.xReading('s1').reading;
    expect(x2.fromSeq).toBe(x1.fromSeq);
    expect(x2.sales.gross).toBe(1500);
    expect(pos.state().accumulators.z_counter).toBe(0);

    const z1 = pos.zReading('s1').reading;
    expect(z1).toMatchObject({ zCounter: 1, beginInvoiceNo: 1, endInvoiceNo: 2, beginGrandTotal: 0, endGrandTotal: 1500, netSales: 1500 });
    expect(code(() => pos.postReversal({ userId: 'c1', online: true, type: 'VOID', invoiceSeq: s.seq, reason: 'late' }))).toBe('AFTER_Z');

    const z2 = pos.zReading('s1').reading; // a zero-sales day still gets a Z
    expect(z2).toMatchObject({ zCounter: 2, beginGrandTotal: 1500, endGrandTotal: 1500, invoiceCount: 0, beginInvoiceNo: null });
  });

  it('T-B8-separate-series: invoices, voids, refunds and readings each have their own gapless series of 6+ digits', () => {
    const { db, pos } = make();
    const a = pos.postSale({ userId: 'c1', online: true, lines: [line(1000, 2)], payments: cash(2000) });
    const b = pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    const v = pos.postReversal({ userId: 'c1', online: true, type: 'VOID', invoiceSeq: b.seq, reason: 'x' });
    const r = pos.postReversal({ userId: 'c1', online: true, type: 'REFUND', invoiceSeq: a.seq, reason: 'x', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    const c = pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    expect([a.number, b.number, c.number]).toEqual(['00000001', '00000002', '00000003']);
    expect([v.number, r.number]).toEqual(['00000001', '00000001']);
    for (const s of db.all<{ width: number }>(`SELECT width FROM doc_series`)) expect(s.width).toBeGreaterThanOrEqual(6);
  });

  it('T-B8-series-rollover: an exhausted series restarts at 1 with the reset counter raised', () => {
    const { db, pos } = make();
    db.run(`UPDATE doc_series SET next_no = 99999999 WHERE doc_type = 'INVOICE'`);
    const a = pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    const b = pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    expect([a.number, a.resetCounter, b.number, b.resetCounter]).toEqual(['99999999', 0, '00000001', 1]);
    expect(b.text).toMatch(/Reset counter\s+1/);
    expect(pos.verify().open.map((i) => i.kind)).toEqual(['NUMBER_GAP']); // the forced jump to 99999999 is caught
  });
});

describe('clock and reversal controls', () => {
  it('refuses to issue when the clock is behind the last document; small drift is logged', () => {
    const { db, pos, clock } = make();
    pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    clock.shift(-4000); // within the 5s tolerance
    pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) });
    expect(actions(db).map((a) => a.action)).toContain('CLOCK_ANOMALY');
    clock.shift(-60_000);
    expect(code(() => pos.postSale({ userId: 'c1', online: true, lines: [line(1000)], payments: cash(1000) }))).toBe('CLOCK_BEHIND');
    expect(actions(db).at(-1)).toMatchObject({ action: 'REJECTED' });
  });

  it('enforces reversal rules', () => {
    const { pos } = make();
    const s = pos.postSale({ userId: 'c1', online: true, lines: [line(1000, 3)], payments: cash(3000) });
    const rev = (o: object) => code(() => pos.postReversal({ userId: 'c1', online: true, type: 'REFUND', invoiceSeq: s.seq, reason: 'x', ...o }));
    expect(rev({ reason: ' ' })).toBe('REASON_REQUIRED');
    expect(rev({ lines: [] })).toBe('LINES_REQUIRED');
    expect(rev({ lines: [{ lineNo: 9, qtyMilli: 1000 }] })).toBe('BAD_LINE');
    expect(rev({ lines: [{ lineNo: 1, qtyMilli: 4000 }] })).toBe('QTY_EXCEEDS');
    expect(rev({ lines: [{ lineNo: 1, qtyMilli: 2000 }, { lineNo: 1, qtyMilli: 2000 }] })).toBe('QTY_EXCEEDS');
    expect(rev({ lines: [{ lineNo: 1, qtyMilli: 2000 }] })).toBe('no error');
    expect(code(() => pos.postReversal({ userId: 'c1', online: true, type: 'VOID', invoiceSeq: s.seq, reason: 'x' }))).toBe('PARTLY_REVERSED');
    expect(rev({ lines: [{ lineNo: 1, qtyMilli: 1000 }] })).toBe('no error');
    expect(rev({ lines: [{ lineNo: 1, qtyMilli: 1 }] })).toBe('QTY_EXCEEDS');
    const x = pos.xReading('s1').posted;
    expect(code(() => pos.postReversal({ userId: 'c1', online: true, type: 'VOID', invoiceSeq: x.seq, reason: 'x' }))).toBe('NOT_AN_INVOICE');
  });

  it('partial refunds add up exactly to the original line', () => {
    const { db, pos } = make();
    const s = pos.postSale({ userId: 'c1', online: true, lines: [{ ...line(333, 3), discounts: [{ type: 'PROMO', amount: 100 }] }], payments: cash(899) });
    for (let i = 0; i < 3; i++) pos.postReversal({ userId: 'c1', online: true, type: 'RETURN', invoiceSeq: s.seq, reason: 'x', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    const sum = db.all<{ body: string }>(`SELECT body FROM ledger_entry WHERE doc_type = 'RETURN'`).reduce((a, r) => a + JSON.parse(r.body).totals.net, 0);
    expect(sum).toBe(899);
  });
});

describe('totals (Phase 1 subset)', () => {
  it('extracts 12% VAT from VAT-inclusive prices and splits mixed sales', () => {
    const { totals } = priceSale([line(11200), line(5000, 1, 'EXEMPT'), line(3000, 1, 'ZERO')], 'VAT', 1200);
    expect(totals).toMatchObject({ gross: 19200, net: 19200, vatable: 10000, vat: 1200, exempt: 5000, zeroRated: 3000 });
  });

  it('handles weighed quantities and per-line discounts', () => {
    const { lines, totals } = priceSale([{ ...line(5200), qtyMilli: 2500, discounts: [{ type: 'PROMO', amount: 300 }] }], 'VAT', 1200);
    expect(lines[0]).toMatchObject({ gross: 13000, discount: 300, net: 12700 });
    expect(totals.discounts).toEqual({ PROMO: 300 });
  });

  it('non-VAT and exempt sellers', () => {
    expect(priceSale([line(1000), line(500, 1, 'EXEMPT')], 'NONVAT', 1200).totals).toMatchObject({ vat: 0, nonVatTaxable: 1000, exempt: 500 });
    expect(priceSale([line(1000)], 'EXEMPT', 1200).totals).toMatchObject({ vat: 0, exempt: 1000 });
    expect(code(() => priceSale([line(1000, 1, 'ZERO')], 'NONVAT', 1200))).toBe('BAD_SALE');
  });

  it('rejects bad input', () => {
    expect(code(() => priceSale([], 'VAT', 1200))).toBe('BAD_SALE');
    expect(code(() => priceSale([line(10.5)], 'VAT', 1200))).toBe('BAD_SALE');
    expect(code(() => priceSale([{ ...line(100), discounts: [{ type: 'X', amount: 101 }] }], 'VAT', 1200))).toBe('BAD_SALE');
  });

  it('settles payments: short, change from cash only', () => {
    expect(settle([{ method: 'CASH', amount: 1000 }], 750)).toEqual({ tendered: 1000, change: 250 });
    expect(code(() => settle([{ method: 'CASH', amount: 500 }], 750))).toBe('BAD_PAYMENT');
    expect(code(() => settle([{ method: 'CARD', amount: 1000 }], 750))).toBe('BAD_PAYMENT');
    expect(settle([{ method: 'CARD', amount: 500 }, { method: 'CASH', amount: 500 }], 750)).toEqual({ tendered: 1000, change: 250 });
  });

  it('VAT rate comes from effective-dated rules, never a constant', () => {
    const { pos, clock } = make();
    pos.addRule('owner', 'VAT_RATE', '2027-01-01', { rateBp: 1500 }, 'hypothetical rate change');
    expect(pos.postSale({ userId: 'c1', online: true, lines: [line(11200)], payments: cash(11200) }).text).toMatch(/VAT amount \(12%\)\s+12\.00/);
    clock.set('2027-01-01T00:00:00.000Z'); // 08:00 Manila time on Jan 1
    expect(pos.postSale({ userId: 'c1', online: true, lines: [line(11500)], payments: cash(11500) }).text).toMatch(/VAT amount \(15%\)\s+15\.00/);
  });
});
