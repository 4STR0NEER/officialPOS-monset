import { describe, expect, it } from 'vitest';
import { CoreError, openCore } from '@monset/core';
import { openNodeDb } from '@monset/storage-node';
import { openSell } from '../src/index.ts';
import { DEMO_PINS, seedDemo } from '../src/demo.ts';

function shop() {
  const db = openNodeDb(':memory:');
  let t = Date.parse('2026-10-27T03:00:00.000Z');
  const now = () => new Date((t += 1000));
  const core = openCore(db, { now });
  core.initTerminal('setup', { terminalId: 'T1', deviceId: 'TAB-1', mode: 'DEMO', vatMode: 'VAT' });
  core.configureSeller('setup', { registeredName: 'Kusina ni Lola Corp.', address: 'Cebu City', tin: '123456789' });
  const sell = openSell(db, core, { now });
  const owner = seedDemo(sell);
  const cashier = sell.login(DEMO_PINS.cashier).id;
  const item = (name: string) => sell.menu().items.find((i) => i.name === name)!;
  const table = (name: string) => sell.menu().tables.find((x) => x.name === name)!;
  return { db, core, sell, owner, cashier, item, table, skip: (ms: number) => void (t += ms) };
}
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as CoreError).code;
  }
  return 'ok';
};

describe('restaurant flow', () => {
  it('seat, order, send, bill, senior share, pay: one invoice, check leaves the board', () => {
    const { core, sell, cashier, item, table } = shop();
    const id = sell.openCheck(cashier, { tableId: table('T5').id, guests: 4 });
    sell.addItem(cashier, id, item('Kare-kare').id);
    sell.addItem(cashier, id, item('Garlic rice').id, { qtyMilli: 4000 });
    sell.addItem(cashier, id, item('Sizzling sisig').id, { modifiers: [{ name: 'Extra egg', price: 2500 }] });
    expect(sell.board()[0]).toMatchObject({ label: 'T5', stage: 'seated', guests: 4, gross: 68000 + 24000 + 29000 });
    sell.sendToKitchen(cashier, id);
    expect(sell.board()[0].stage).toBe('ordered');
    const bill = sell.printBill(cashier, true, id);
    expect(bill.docType).toBe('ORDER'); // the bill is a supplementary document, never an invoice
    sell.setSpecials(cashier, id, [{ type: 'SC', holder: { name: 'Remedios Santos', idNo: 'OSCA-1', idType: 'OSCA ID' }, diners: 4 }]);
    const due = sell.check(id).preview.due;
    expect(due).toBeLessThan(121000);
    const inv = sell.pay(cashier, true, id, [{ method: 'CASH', amount: 120000 }]);
    expect(inv.docType).toBe('INVOICE');
    expect(inv.text).toContain('Sizzling sisig (Extra egg)');
    expect(sell.board()).toEqual([]);
    expect(core.verify().ok).toBe(true);
  });

  it('a table holds one open check; move, merge and split work and are logged', () => {
    const { db, sell, cashier, item, table } = shop();
    const a = sell.openCheck(cashier, { tableId: table('T1').id, guests: 2 });
    expect(code(() => sell.openCheck(cashier, { tableId: table('T1').id, guests: 2 }))).toBe('TABLE_BUSY');
    const b = sell.openCheck(cashier, { tableId: table('T2').id, guests: 3 });
    sell.addItem(cashier, a, item('Chicken adobo').id, { qtyMilli: 2000 });
    sell.addItem(cashier, b, item('Halo-halo').id);
    sell.moveTable(cashier, a, table('T9').id);
    sell.merge(cashier, a, b);
    const merged = sell.check(a).check;
    expect(merged).toMatchObject({ label: 'T9', guests: 5 });
    expect(merged.lines).toHaveLength(2);
    const split = sell.split(cashier, a, [{ lineId: merged.lines[0].id, qtyMilli: 1000 }]);
    expect(sell.check(split).check.lines[0].qtyMilli).toBe(1000);
    expect(sell.check(a).check.lines[0].qtyMilli).toBe(1000);
    expect(db.all<{ action: string }>(`SELECT action FROM activity_log WHERE action LIKE 'CHECK_%'`).map((r) => r.action)).toEqual(['CHECK_MOVE', 'CHECK_MERGE', 'CHECK_SPLIT']);
  });

  it('taking back food the kitchen already has needs a supervisor PIN', () => {
    const { sell, cashier, item } = shop();
    const id = sell.openCheck(cashier, { label: 'Takeout', guests: 1 });
    sell.addItem(cashier, id, item('Lechon kawali').id, { qtyMilli: 2000 });
    const line = sell.check(id).check.lines[0];
    sell.setQty(cashier, id, line.id, 1000); // not sent yet: free to change
    sell.sendToKitchen(cashier, id);
    expect(code(() => sell.setQty(cashier, id, line.id, 0, '1111'))).toBe('NOT_ALLOWED');
    sell.setQty(cashier, id, line.id, 0, DEMO_PINS.supervisor);
    expect(sell.check(id).check.lines).toEqual([]);
    expect(code(() => sell.cancelCheck(cashier, id, ''))).toBe('REASON_REQUIRED');
  });

  it('PIN sign-in: good and bad attempts are both in the activity log', () => {
    const { db, sell } = shop();
    expect(code(() => sell.login('0000'))).toBe('BAD_PIN');
    expect(sell.login(DEMO_PINS.owner).role).toBe('owner');
    expect(db.all<{ action: string }>(`SELECT action FROM activity_log WHERE action LIKE 'LOGIN%'`).map((r) => r.action)).toEqual(['LOGIN', 'LOGIN_FAILED', 'LOGIN']);
  });

  it('retail: barcode lookup and a quick sale with the solo-parent discount on baby milk only', () => {
    const { sell, cashier } = shop();
    const milk = sell.itemByBarcode('4800361380137')!;
    const eggs = sell.itemByBarcode('4800016644214')!;
    const lines = [milk, eggs].map((i) => ({ description: i.name, qtyMilli: 1000, unitPrice: i.price, vatClass: i.vatClass, category: i.discountCategory ?? undefined }));
    const specials = [{ type: 'SOLO', holder: { name: 'Ana', idNo: 'SP-1', idType: 'Solo Parent ID' }, items: [{ lineNo: 1, qtyMilli: 1000 }] }];
    const p = sell.previewLines(lines, specials)!;
    expect(p.totals.discounts).toEqual({ SOLO: 10000 });
    const inv = sell.quickSale(cashier, true, lines, [{ method: 'CASH', amount: p.totals.net }], specials);
    expect(inv.docType).toBe('INVOICE');
  });
});
