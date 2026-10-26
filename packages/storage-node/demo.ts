// Phase 1 test harness: one simulated business day, printed as the e-journal.
// Run: npm run demo
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCore, peso } from '@monset/core';
import { openNodeDb } from './src/index.ts';

const db = openNodeDb(join(mkdtempSync(join(tmpdir(), 'mpos-')), 'demo.db'));
const pos = openCore(db);
pos.initTerminal('owner', { terminalId: 'T1', deviceId: 'DEMO-TABLET-1', mode: 'DEMO', vatMode: 'VAT' });

const a = pos.postSale({
  userId: 'cashier1', online: true,
  lines: [
    { description: 'Chicken adobo rice bowl', qtyMilli: 2000, unitPrice: 18500, vatClass: 'VATABLE' },
    { description: 'Calamansi juice', qtyMilli: 1000, unitPrice: 6000, vatClass: 'VATABLE', discounts: [{ type: 'PROMO', amount: 1000 }] },
  ],
  payments: [{ method: 'CASH', amount: 50000 }],
});
const b = pos.postSale({
  userId: 'cashier1', online: false,
  lines: [{ description: 'Rice (kg)', qtyMilli: 2500, unitPrice: 5200, vatClass: 'EXEMPT' }],
  payments: [{ method: 'GCASH', amount: 13000 }],
});
pos.postSale({ userId: 'cashier1', online: true, lines: [{ description: 'Mineral water', qtyMilli: 1000, unitPrice: 2500, vatClass: 'VATABLE' }], payments: [{ method: 'CASH', amount: 2500 }] });
pos.postReversal({ userId: 'cashier1', approvedBy: 'sup1', online: true, type: 'VOID', invoiceSeq: b.seq, reason: 'Wrong item keyed' });
pos.postReversal({ userId: 'cashier1', approvedBy: 'sup1', online: true, type: 'REFUND', invoiceSeq: a.seq, reason: 'Cold food', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
pos.xReading('sup1');
const { reading } = pos.zReading('sup1');

console.log(pos.exportJournal('owner'));
console.log(`\nZ: net sales ${peso(reading.netSales)}, grand total ${peso(reading.endGrandTotal)}, integrity ${pos.verify().ok ? 'OK' : 'BROKEN'}`);
db.close();
