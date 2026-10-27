// Test harness: one simulated business day, printed as the 80mm e-journal, plus an A4 invoice.
// Run: npm run demo
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCore, peso } from '@monset/core';
import { openNodeDb } from './src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'mpos-'));
const db = openNodeDb(join(dir, 'demo.db'));
const pos = openCore(db);
pos.initTerminal('owner', { terminalId: 'T1', deviceId: 'DEMO-TABLET-1', mode: 'DEMO', vatMode: 'VAT' });
pos.configureSeller('owner', { registeredName: 'Kusina ni Lola Corp.', businessName: "Lola's Kitchen", address: '12 Osmeña Blvd, Cebu City 6000', tin: '123-456-789-00000' });

const a = pos.postSale({
  userId: 'cashier1', online: true,
  lines: [
    { description: 'Chicken adobo rice bowl', qtyMilli: 2000, unitPrice: 18500, vatClass: 'VATABLE' },
    { description: 'Calamansi juice', qtyMilli: 1000, unitPrice: 6000, vatClass: 'VATABLE', discounts: [{ type: 'PROMO', amount: 1000 }] },
  ],
  payments: [{ method: 'CASH', amount: 50000 }],
});
const sc = pos.postSale({
  userId: 'cashier1', online: true,
  lines: [{ description: 'Kare-kare', qtyMilli: 1000, unitPrice: 68000, vatClass: 'VATABLE' }, { description: 'Rice', qtyMilli: 4000, unitPrice: 4500, vatClass: 'VATABLE' }],
  payments: [{ method: 'CASH', amount: 100000 }],
  specialDiscounts: [{ type: 'SC', holder: { name: 'Remedios Santos', idNo: 'OSCA-0001', idType: 'OSCA ID' }, diners: 4 }],
});
const b = pos.postSale({
  userId: 'cashier1', online: false,
  lines: [{ description: 'Rice (kg)', qtyMilli: 2500, unitPrice: 5200, vatClass: 'EXEMPT' }],
  payments: [{ method: 'GCASH', amount: 13000 }],
});
pos.postReversal({ userId: 'cashier1', approvedBy: 'sup1', online: true, type: 'VOID', invoiceSeq: b.seq, reason: 'Wrong item keyed' });
pos.postReversal({ userId: 'cashier1', approvedBy: 'sup1', online: true, type: 'REFUND', invoiceSeq: a.seq, reason: 'Cold food', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
pos.issueSupplementary({ userId: 'cashier1', online: true, type: 'ORDER', lines: [{ description: 'Halo-halo', qtyMilli: 2000, unitPrice: 16000, vatClass: 'VATABLE' }], reference: 'Table 3' });
pos.xReading('sup1');
const { reading } = pos.zReading('sup1');

console.log(pos.exportJournal('owner'));
const a4 = join(dir, 'invoice-senior-a4.html');
writeFileSync(a4, pos.print('owner', sc.seq, 'html').output as string);
console.log(`\nZ: net sales ${peso(reading.netSales)}, grand total ${peso(reading.endGrandTotal)}, integrity ${pos.verify().ok ? 'OK' : 'BROKEN'}`);
console.log(`A4 invoice: ${a4}`);
db.close();
