import { expect, it } from 'vitest';
import { make } from './helpers.ts';

// G-EJ-01: a fixed business day rendered as the e-journal. Any layout change shows up as a diff
// against golden/ej-day.txt; update deliberately with `npx vitest run -u` and review the diff.
it('G-EJ-01 / G-X-01 / G-Z-01: e-journal of a full day is byte-stable', async () => {
  const { pos } = make();
  pos.updateTerminal('owner', { min: '260000000001', sln: 'MPOS-26-ABCDEF-7', ptuNo: '[TO BE ISSUED]' });
  const a = pos.postSale({
    userId: 'cashier1', online: true,
    lines: [
      { description: 'Chicken adobo rice bowl', qtyMilli: 2000, unitPrice: 18500, vatClass: 'VATABLE' },
      { description: 'Calamansi juice', qtyMilli: 1000, unitPrice: 6000, vatClass: 'VATABLE', discounts: [{ type: 'PROMO', amount: 1000 }] },
    ],
    payments: [{ method: 'CASH', amount: 50000 }],
  });
  const b = pos.postSale({ userId: 'cashier1', online: false, lines: [{ description: 'Rice (kg)', qtyMilli: 2500, unitPrice: 5200, vatClass: 'EXEMPT' }], payments: [{ method: 'GCASH', amount: 13000 }] });
  pos.postReversal({ userId: 'cashier1', approvedBy: 'sup1', online: true, type: 'VOID', invoiceSeq: b.seq, reason: 'Wrong item keyed' });
  pos.postReversal({ userId: 'cashier1', approvedBy: 'sup1', online: true, type: 'REFUND', invoiceSeq: a.seq, reason: 'Cold food', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
  pos.xReading('sup1');
  pos.zReading('sup1');
  await expect(pos.exportJournal('owner')).toMatchFileSnapshot('./golden/ej-day.txt');
});
