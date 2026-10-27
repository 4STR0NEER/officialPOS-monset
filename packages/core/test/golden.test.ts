import { describe, expect, it } from 'vitest';
import { renderText, type Block, type SaleLine } from '@monset/core';
import { cash, make } from './helpers.ts';

// Golden files: every document type, byte-exact, at 58mm (32 cols), 80mm (48 cols) and A4.
// They double as the sample-document pack for the BIR demo. Update deliberately with
// `npx vitest run -u` and review the diff. The seal is masked here because each test terminal
// gets a fresh random key; phase2.test.ts verifies the seal itself.
const maskText = (s: string) => s.replace(/Seal:\s+MPOS1[\s\S]*?(?=\n=+\n)/g, 'Seal: <signed validation seal>');
const maskHtml = (s: string) => s.replace(/<figure class="qr">[\s\S]*?<\/figure>/g, '<figure class="qr"><!-- signed validation seal --></figure>');

const dish = (description: string, price: number, qty = 1): SaleLine => ({ description, qtyMilli: qty * 1000, unitPrice: price, vatClass: 'VATABLE' });

function journalAt(db: ReturnType<typeof make>['db'], cols: number) {
  return db
    .all<{ blocks: string }>(`SELECT blocks FROM journal ORDER BY seq`)
    .map((r) => renderText(JSON.parse(r.blocks) as Block[], cols))
    .join('\n\n');
}

describe('golden documents', () => {
  it('G-EJ-01 / G-INV-* / G-X-01 / G-Z-01: a full restaurant day, 58mm and 80mm', async () => {
    const { db, pos } = make({ min: '26010100001', serial: 'TAB-S9-0042', sln: 'MPOS-26-ABCDEF-7', ptuNo: '[TO BE ISSUED]' });
    const u = 'cashier1';

    // G-INV-MIXED: VAT buyer, VATable + exempt + zero-rated, a promo
    pos.postSale({
      userId: u, online: true,
      lines: [
        { ...dish('Lechon kawali family platter', 89500), discounts: [{ type: 'PROMO', amount: 5000 }] },
        { description: 'Fresh eggs (tray)', qtyMilli: 1000, unitPrice: 26000, vatClass: 'EXEMPT' },
        { description: 'Export order packaging', qtyMilli: 1000, unitPrice: 15000, vatClass: 'ZERO' },
      ],
      payments: [{ method: 'CARD', amount: 125500, ref: 'AUTH 448812' }],
      buyer: { vatRegistered: true, name: 'ABC Trading Corp.', address: '88 A.S. Fortuna St, Mandaue City', tin: '111-222-333-00002', businessStyle: 'ABC Hardware' },
    });
    // G-INV-SC: senior's own items
    const sc = pos.postSale({
      userId: u, online: true,
      lines: [dish('Sinigang na baboy', 32000), dish('Rice', 4500, 2)],
      payments: cash(31000),
      specialDiscounts: [{ type: 'SC', holder: { name: 'Remedios Santos', idNo: 'OSCA-CEB-0001', idType: 'OSCA ID' }, items: [{ lineNo: 1, qtyMilli: 1000 }, { lineNo: 2, qtyMilli: 1000 }] }],
    });
    // G-INV-PWD online (no signature line)
    pos.postSale({
      userId: 'app', online: true,
      lines: [dish('Chicken inasal meal', 19900)],
      payments: [{ method: 'GCASH', amount: 14214, ref: 'GC-77120' }],
      specialDiscounts: [{ type: 'PWD', channel: 'ONLINE', holder: { name: 'Juan Dela Cruz', idNo: 'PWD-0722-1199', idType: 'PWD ID', tin: '987-654-321' }, items: [{ lineNo: 1, qtyMilli: 1000 }] }],
    });
    // G-INV-GROUP: one senior and one PWD among six diners sharing everything
    pos.postSale({
      userId: u, online: false,
      lines: [dish('Kare-kare', 68000), dish('Crispy pata', 79000), dish('Garlic rice', 4500, 6)],
      payments: cash(160000),
      specialDiscounts: [
        { type: 'SC', holder: { name: 'Benito Garcia', idNo: 'DNSC-2025-55', idType: 'Digital National Senior Citizen ID' }, diners: 6 },
        { type: 'PWD', holder: { name: 'Liza Ramos', idNo: 'PWD-0722-3001', idType: 'PWD ID' }, diners: 6 },
      ],
    });
    // G-INV-NAAC and G-INV-SOLO
    pos.postSale({ userId: u, online: true, lines: [dish('Protein shake', 15000)], payments: cash(10715), specialDiscounts: [{ type: 'NAAC', holder: { name: 'Hidilyn D.', idNo: 'NAAC-0042', idType: 'NAAC ID' }, items: [{ lineNo: 1, qtyMilli: 1000 }] }] });
    pos.postSale({
      userId: u, online: true,
      lines: [{ description: 'Infant formula 900g', qtyMilli: 1000, unitPrice: 112000, vatClass: 'VATABLE', category: 'BABY_MILK' }, dish('Iced coffee', 12000)],
      payments: cash(102000),
      specialDiscounts: [{ type: 'SOLO', holder: { name: 'Ana Villanueva', idNo: 'SP-CEB-0310', idType: 'Solo Parent ID' }, items: [{ lineNo: 1, qtyMilli: 1000 }] }],
    });
    const plain = pos.postSale({ userId: u, online: true, lines: [dish('Halo-halo', 16000)], payments: cash(20000) });
    const ret = pos.postSale({ userId: u, online: true, lines: [dish('Bottled water', 3500, 4)], payments: cash(14000) });

    pos.postReversal({ userId: u, approvedBy: 'sup1', online: true, type: 'VOID', invoiceSeq: plain.seq, reason: 'Wrong item keyed' });
    pos.postReversal({ userId: u, approvedBy: 'sup1', online: true, type: 'REFUND', invoiceSeq: sc.seq, reason: 'Dish served cold', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    pos.postReversal({ userId: u, approvedBy: 'sup1', online: true, type: 'RETURN', invoiceSeq: ret.seq, reason: 'Unopened, returned', lines: [{ lineNo: 1, qtyMilli: 2000 }] });

    const order = pos.issueSupplementary({ userId: u, online: true, type: 'ORDER', lines: [dish('Kare-kare', 68000), dish('Garlic rice', 4500, 3)], reference: 'Table 7' });
    pos.issueSupplementary({ userId: u, online: true, type: 'ACK', amount: 300000, party: { name: 'Maria Lim' }, reference: 'Deposit: birthday party, Nov 15', payments: [{ method: 'CASH', amount: 300000 }] });
    pos.issueSupplementary({ userId: u, online: true, type: 'COLLECTION', amount: 450000, party: { name: 'XYZ Corp.', tin: '555666777' }, reference: 'Catering invoice 00000123', payments: [{ method: 'BANK', amount: 450000, ref: 'BDO 0091' }] });
    pos.cancelSupplementary('sup1', true, order.seq, 'Table walked out before serving');
    pos.recordManualInvoice({ userId: 'sup1', online: true, manualNo: 'BKLT-000451', issuedOn: '2026-10-26', lines: [dish('Party tray (manual)', 250000)], buyer: { name: 'Corporate client' }, reason: 'Power outage 13:10-13:40' });

    pos.xReading('sup1');
    pos.zReading('sup1');

    await expect(maskText(journalAt(db, 48))).toMatchFileSnapshot('./golden/day-80mm.txt');
    await expect(maskText(journalAt(db, 32))).toMatchFileSnapshot('./golden/day-58mm.txt');
    await expect(maskHtml(pos.print('owner', sc.seq, 'html').output as string)).toMatchFileSnapshot('./golden/invoice-sc-a4.html');
    await expect(maskText(pos.print('owner', sc.seq).output as string)).toMatchFileSnapshot('./golden/invoice-sc-reprint-80mm.txt');
    expect(pos.verify().ok).toBe(true);
  });

  it('G-INV-NONVAT / G-INV-EXEMPT / G-INV-DEMO', async () => {
    const sale = (o: Parameters<typeof make>[0]) => {
      const { pos } = make(o);
      return maskText(pos.postSale({ userId: 'cashier1', online: true, lines: [dish('Haircut', 25000), { description: 'Hair tonic', qtyMilli: 1000, unitPrice: 8000, vatClass: 'EXEMPT' }], payments: cash(33000) }).text);
    };
    await expect(sale({ vatMode: 'NONVAT' })).toMatchFileSnapshot('./golden/invoice-nonvat-80mm.txt');
    await expect(sale({ vatMode: 'EXEMPT' })).toMatchFileSnapshot('./golden/invoice-exempt-80mm.txt');
    await expect(sale({ mode: 'DEMO', paper: '58' })).toMatchFileSnapshot('./golden/invoice-demo-58mm.txt');
  });

  it('T-C2-no-official-receipt: no golden document anywhere says "Official Receipt"', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('./golden/', import.meta.url);
    for (const f of readdirSync(dir)) expect(readFileSync(new URL(f, dir), 'utf8')).not.toMatch(/official\s+receipt/i);
  });
});

