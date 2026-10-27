import { describe, expect, it } from 'vitest';
import { CoreError, openCore, priceSale, renderEscPos, SUPPLEMENTARY_FOOTER, verifySeal, type DiscountRule, type SaleLine } from '@monset/core';
import { openNodeDb } from '@monset/storage-node';
import { cash, flat, make, TERMINAL } from './helpers.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as CoreError).code ?? (e as Error).message;
  }
  return 'no error';
};

const SC: DiscountRule = { code: 'SC', label: 'Senior Citizen', rateBp: 2000, vatExempt: true, categories: null, idTypes: ['OSCA ID', 'Digital National Senior Citizen ID'], requireTin: false };
const SOLO: DiscountRule = { code: 'SOLO', label: 'Solo Parent', rateBp: 1000, vatExempt: true, categories: ['BABY_MILK'], idTypes: ['Solo Parent ID'], requireTin: false };
const rules = (code: string) => ({ SC, SOLO })[code as 'SC'];
const senior = (o: object = {}) => ({ type: 'SC', holder: { name: 'Lola Remedios Santos', idNo: 'OSCA-0001', idType: 'OSCA ID' }, ...o });
const food = (price: number, qty = 1): SaleLine => ({ description: 'Pancit canton', qtyMilli: qty * 1000, unitPrice: price, vatClass: 'VATABLE' });

describe('special discounts: worked examples (C14, C15, C16)', () => {
  it('T-C14-order-of-ops: VAT comes off first, then 20% of the VAT-free price', () => {
    const r = priceSale([food(11200)], 'VAT', 1200, [senior({ items: [{ lineNo: 1, qtyMilli: 1000 }] })], rules);
    // 112.00 -> 100.00 without VAT (12.00 exemption) -> 20.00 discount -> 80.00 due, all VAT-exempt
    expect(r.specialDiscounts[0]).toMatchObject({ coveredGross: 11200, vatExemption: 1200, discount: 2000, net: 8000 });
    expect(r.totals).toMatchObject({ gross: 11200, vatExemption: 1200, discount: 2000, net: 8000, vatable: 0, vat: 0, exempt: 8000 });
  });

  it('T-C15-group-prorata: one senior among five diners gets a fifth of the shared order', () => {
    const r = priceSale([food(56000), food(56000)], 'VAT', 1200, [senior({ diners: 5 })], rules);
    // 1,120.00 shared; senior share 224.00 -> 200.00 + 24.00 VAT -> 40.00 off -> 160.00
    expect(r.specialDiscounts[0]).toMatchObject({ basis: 'GROUP_SHARE', coveredGross: 22400, vatExemption: 2400, discount: 4000, net: 16000 });
    expect(r.totals).toMatchObject({ net: 105600, exempt: 16000, vatable: 80000, vat: 9600 });
  });

  it('T-C15-identified-items: only the holder\'s own items are discounted', () => {
    const r = priceSale([food(11200), food(22400)], 'VAT', 1200, [senior({ items: [{ lineNo: 1, qtyMilli: 1000 }] })], rules);
    expect(r.lines[0]).toMatchObject({ vatExemption: 1200, discount: 2000, net: 8000 });
    expect(r.lines[1]).toMatchObject({ vatExemption: 0, discount: 0, net: 22400 });
  });

  it('two seniors in a group of four each get a quarter; the shares never exceed the line', () => {
    const two = [senior({ diners: 4 }), senior({ diners: 4, holder: { name: 'Lolo Ben', idNo: 'OSCA-0002' } })];
    const r = priceSale([food(10001)], 'VAT', 1200, two, rules);
    for (const sd of r.specialDiscounts) expect(Math.abs(sd.coveredGross - 2500)).toBeLessThanOrEqual(1); // 100.01 / 4: cumulative rounding gives 25.00 then 25.01
    expect(r.lines[0].net + r.lines[0].discount + r.lines[0].vatExemption).toBe(10001);
    expect(code(() => priceSale([food(1000)], 'VAT', 1200, [senior({ diners: 1 }), senior({ diners: 1, holder: { name: 'B', idNo: 'X2' } })], rules))).toBe('OVER_COVERED');
  });

  it('P-C16-no-double: a promo and a special discount never stack; the bigger one wins', () => {
    const promoBig = priceSale([{ ...food(10000), vatClass: 'EXEMPT', discounts: [{ type: 'PROMO', amount: 5000 }] }], 'VAT', 1200, [senior({ items: [{ lineNo: 1, qtyMilli: 1000 }] })], rules);
    expect(promoBig.totals).toMatchObject({ discount: 5000, discounts: { PROMO: 5000 }, net: 5000 });
    const scBig = priceSale([{ ...food(11200), discounts: [{ type: 'PROMO', amount: 500 }] }], 'VAT', 1200, [senior({ items: [{ lineNo: 1, qtyMilli: 1000 }] })], rules);
    expect(scBig.totals).toMatchObject({ discounts: { SC: 2000 }, vatExemption: 1200, net: 8000 });
    expect(code(() => priceSale([food(1000)], 'VAT', 1200, [senior({ diners: 2 }), senior({ diners: 2 })], rules))).toBe('DOUBLE_DISCOUNT');
  });

  it('eligibility, IDs and required fields come from the rule', () => {
    const milk: SaleLine = { description: 'Infant formula', qtyMilli: 1000, unitPrice: 11200, vatClass: 'VATABLE', category: 'BABY_MILK' };
    const solo = (items: { lineNo: number; qtyMilli: number }[]) => [{ type: 'SOLO', holder: { name: 'Ana', idNo: 'SP-1', idType: 'Solo Parent ID' }, items }];
    expect(priceSale([milk, food(5000)], 'VAT', 1200, solo([{ lineNo: 1, qtyMilli: 1000 }]), rules).totals.discounts).toEqual({ SOLO: 1000 });
    expect(code(() => priceSale([milk, food(5000)], 'VAT', 1200, solo([{ lineNo: 2, qtyMilli: 1000 }]), rules))).toBe('NOT_ELIGIBLE');
    expect(code(() => priceSale([food(100)], 'VAT', 1200, [senior({ diners: 2, holder: { name: 'A', idNo: 'B', idType: 'Library card' } })], rules))).toBe('BAD_DISCOUNT');
    expect(code(() => priceSale([food(100)], 'VAT', 1200, [senior({ diners: 2, holder: { name: '', idNo: 'B' } })], rules))).toBe('BAD_DISCOUNT');
    expect(code(() => priceSale([food(100)], 'VAT', 1200, [{ type: 'NOPE', holder: { name: 'A', idNo: 'B' }, diners: 1 }], rules))).toBe('BAD_DISCOUNT');
  });

  it('non-VAT sellers: no VAT to exempt, 20% straight off', () => {
    const r = priceSale([food(10000)], 'NONVAT', 1200, [senior({ items: [{ lineNo: 1, qtyMilli: 1000 }] })], rules);
    expect(r.totals).toMatchObject({ vatExemption: 0, discount: 2000, net: 8000, nonVatTaxable: 8000 });
  });
});

describe('special discounts in the ledger (C9-C13)', () => {
  it('T-C9-new-type-via-config: a new discount type is a rule row, not a code change', () => {
    const { pos } = make();
    expect(pos.discountTypes().map((d) => d.code)).toEqual(['NAAC', 'PWD', 'PWD_BNPC', 'SC', 'SC_BNPC', 'SOLO']);
    pos.addRule('owner', 'DISCOUNT_TYPE:MEDAL', '2026-01-01', { code: 'MEDAL', label: 'Medal of Valor', rateBp: 2000, vatExempt: true, categories: null, idTypes: ['AFP ID'], requireTin: false }, 'hypothetical, for test');
    const s = pos.postSale({ userId: 'c1', online: true, lines: [food(11200)], payments: cash(8000), specialDiscounts: [{ type: 'MEDAL', holder: { name: 'Sgt. Cruz', idNo: 'AFP-9' }, items: [{ lineNo: 1, qtyMilli: 1000 }] }] });
    expect(flat(s.text)).toContain('MEDAL OF VALOR DISCOUNT');
  });

  it('T-C10 / T-C11-online-no-sig: in-store discounts print a signature line; online ones do not, but keep ID, TIN and breakdown', () => {
    const { pos } = make();
    const sale = (channel: 'IN_STORE' | 'ONLINE') =>
      pos.postSale({ userId: 'c1', online: true, lines: [food(11200)], payments: cash(8000), specialDiscounts: [{ type: 'PWD', channel, holder: { name: 'Juan Dela Cruz', idNo: 'PWD-77', idType: 'PWD ID', tin: '987-654-321' }, items: [{ lineNo: 1, qtyMilli: 1000 }] }] }).text;
    const store = flat(sale('IN_STORE'));
    const online = flat(sale('ONLINE'));
    for (const t of [store, online]) for (const s of ['PWD DISCOUNT', 'Juan Dela Cruz', 'PWD-77', '987-654-321', 'Less: VAT exemption -12.00', 'Less: discount (20%) -20.00']) expect(t).toContain(s);
    expect(store).toContain('Signature: ___');
    expect(online).not.toContain('Signature');
  });

  it('T-C12-digital-id / T-C13-no-booklet: the digital national SC ID is accepted and medicine needs no booklet', () => {
    const { pos } = make();
    const med: SaleLine = { description: 'Losartan 50mg', qtyMilli: 30000, unitPrice: 1500, vatClass: 'VATABLE', category: 'MEDICINE' };
    const s = pos.postSale({ userId: 'c1', online: true, lines: [med], payments: cash(40000), specialDiscounts: [{ type: 'SC', holder: { name: 'Lola', idNo: 'DNSCID-123', idType: 'Digital National Senior Citizen ID' }, items: [{ lineNo: 1, qtyMilli: 30000 }] }] });
    expect(flat(s.text)).toContain('Digital National Senior Citizen ID');
    expect(JSON.stringify(pos.discountTypes())).not.toMatch(/booklet/i);
  });

  it('refunding part of a senior\'s order reverses the exemption and discount in proportion', () => {
    const { db, pos } = make();
    const s = pos.postSale({ userId: 'c1', online: true, lines: [food(11200, 2)], payments: cash(16000), specialDiscounts: [senior({ items: [{ lineNo: 1, qtyMilli: 2000 }] })] });
    pos.postReversal({ userId: 'c1', online: true, type: 'REFUND', invoiceSeq: s.seq, reason: 'x', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
    const b = JSON.parse(db.get<{ body: string }>(`SELECT body FROM ledger_entry WHERE doc_type = 'REFUND'`)!.body);
    expect(b.totals).toMatchObject({ gross: 11200, vatExemption: 1200, discounts: { SC: 2000 }, net: 8000, exempt: 8000 });
  });
});

describe('invoice content (C1-C8, C17-C19)', () => {
  it('T-C1-header: seller, VAT REG TIN with branch, MIN, SN and SLN', () => {
    const { pos } = make({ min: '26010100001', serial: 'TAB-S9-0042', sln: 'MPOS-26-ABCDEF-7' });
    const t = flat(pos.postSale({ userId: 'c1', online: true, lines: [food(10000)], payments: cash(10000) }).text);
    for (const s of ['Kusina ni Lola Corp.', "Lola's Kitchen", '12 Osmeña Blvd', 'VAT REG TIN 123-456-789-00000', 'MIN: 26010100001', 'SN: TAB-S9-0042', 'SLN: MPOS-26-ABCDEF-7']) expect(t).toContain(s);
  });

  it('T-C2 / T-C3: the document is an INVOICE with number and local date and time, never an Official Receipt', () => {
    const { pos } = make();
    const t = flat(pos.postSale({ userId: 'c1', online: true, lines: [food(10000)], payments: cash(10000) }).text);
    expect(t).toMatch(/INVOICE Invoice No\. 00000001 Date 2026-10-26 09:00:\d\d/);
    expect(t).not.toMatch(/official receipt/i);
  });

  it('T-C4-vat-buyer-required: a VAT-registered buyer must give name, address and TIN', () => {
    const { pos } = make();
    const sale = (buyer: object) => code(() => pos.postSale({ userId: 'c1', online: true, lines: [food(10000)], payments: cash(10000), buyer }));
    expect(sale({ vatRegistered: true, name: 'ABC Trading' })).toBe('BUYER_REQUIRED');
    expect(sale({ tin: '12345' })).toBe('BAD_TIN');
    const ok = pos.postSale({ userId: 'c1', online: true, lines: [food(10000)], payments: cash(10000), buyer: { vatRegistered: true, name: 'ABC Trading', address: 'Mandaue City', tin: '111222333 00002', businessStyle: 'ABC Hardware' } });
    expect(flat(ok.text)).toMatch(/Sold to ABC Trading Address Mandaue City TIN 111-222-333-00002 Business style ABC Hardware/);
    expect(flat(pos.postSale({ userId: 'c1', online: true, lines: [food(10000)], payments: cash(10000) }).text)).toContain('Sold to ____');
  });

  it('T-C6 / T-C7 / T-C8: VAT breakdown, percentage-tax breakdown, and EXEMPT printed prominently', () => {
    const lines = [food(11200), { ...food(5000), vatClass: 'EXEMPT' as const }];
    const vat = flat(make().pos.postSale({ userId: 'c1', online: true, lines: [...lines, { ...food(3000), vatClass: 'ZERO' as const }], payments: cash(19200) }).text);
    expect(vat).toContain('VATable sales 100.00 VAT amount (12%) 12.00 VAT-exempt sales 50.00 Zero-rated sales 30.00');
    const nonvat = flat(make({ vatMode: 'NONVAT' }).pos.postSale({ userId: 'c1', online: true, lines, payments: cash(16200) }).text);
    expect(nonvat).toContain('NON VAT REG TIN');
    expect(nonvat).toContain('Sales subject to percentage tax 112.00 Exempt sales 50.00');
    const ex = make({ vatMode: 'EXEMPT' }).pos.postSale({ userId: 'c1', online: true, lines, payments: cash(16200) }).text;
    expect(ex).toMatch(/^\s+EXEMPT$/m);
  });

  it('T-C17 / T-C18: supplier accreditation and PTU (or AC) details in the footer, placeholders until issued', () => {
    const { pos } = make({ ptuLabel: 'AC No.', ptuNo: 'AC-0001', ptuDate: '2026-11-01' });
    let t = flat(pos.postSale({ userId: 'c1', online: true, lines: [food(100)], payments: cash(100) }).text);
    expect(t).toContain('Supplier Monset.co');
    expect(t).toContain('Accreditation No. [TO BE ISSUED]');
    expect(t).toContain('AC No. AC-0001 Date issued 2026-11-01');
    pos.configureSupplier('owner', { accreditationNo: 'TEST-ACC-1', accreditationValidUntil: '2031-12-31' });
    t = flat(pos.postSale({ userId: 'c1', online: true, lines: [food(100)], payments: cash(100) }).text);
    expect(t).toContain('Accreditation No. TEST-ACC-1');
  });

  it('refuses invoices until the seller is configured', () => {
    const pos = openCore(openNodeDb(':memory:'));
    pos.initTerminal('owner', TERMINAL);
    expect(code(() => pos.postSale({ userId: 'c1', online: true, lines: [food(100)], payments: cash(100) }))).toBe('NO_SELLER');
  });
});

describe('supplementary documents (A5, C19)', () => {
  it('T-C19-footer-on-all-supp: order slips, acknowledgment and collection receipts, cancellations', () => {
    const { pos } = make();
    const o = pos.issueSupplementary({ userId: 'c1', online: true, type: 'ORDER', lines: [food(15000, 2)], reference: 'Table 4' });
    const a = pos.issueSupplementary({ userId: 'c1', online: true, type: 'ACK', amount: 50000, party: { name: 'Maria Lim' }, reference: 'Deposit for party tray' });
    const c = pos.issueSupplementary({ userId: 'c1', online: true, type: 'COLLECTION', amount: 120000, party: { name: 'XYZ Corp', tin: '555666777' }, reference: 'Invoice 00000123' });
    const x = pos.cancelSupplementary('sup1', true, o.seq, 'Customer left');
    for (const d of [o, a, c, x]) expect(flat(d.text)).toContain(SUPPLEMENTARY_FOOTER);
    expect([o.number, a.number, c.number, x.number]).toEqual(['00000001', '00000001', '00000001', '00000001']);
    expect(flat(o.text)).toContain('ORDER SLIP');
    expect(flat(o.text)).toContain('TOTAL 300.00');
    expect(code(() => pos.cancelSupplementary('sup1', true, o.seq, 'again'))).toBe('ALREADY_CANCELLED');
    expect(pos.verify().ok).toBe(true);
  });

  it('T-A5-slip-footer: an ordering-only install issues slips (with the footer) but never invoices', () => {
    const { pos } = make({ mode: 'NON_INVOICING' });
    expect(flat(pos.issueSupplementary({ userId: 'c1', online: true, type: 'ORDER', lines: [food(100)] }).text)).toContain(SUPPLEMENTARY_FOOTER);
    expect(code(() => pos.postSale({ userId: 'c1', online: true, lines: [food(100)], payments: cash(100) }))).toBe('NON_INVOICING');
  });
});

describe('reprint and seal (B9, B11)', () => {
  it('T-B9-reprint-banner / reprint-logged: the first print is the original, later ones say REPRINT #n', () => {
    const { db, pos } = make();
    const s = pos.postSale({ userId: 'c1', online: true, lines: [food(10000)], payments: cash(10000) });
    const first = pos.print('c1', s.seq);
    const again = pos.print('sup1', s.seq);
    const third = pos.print('sup1', s.seq, 'html');
    expect(first).toMatchObject({ copyNo: 0, reprint: false });
    expect(first.output).not.toContain('REPRINT');
    expect(again.output).toContain('*** REPRINT #1 ***');
    expect(third.output).toContain('*** REPRINT #2 ***');
    expect((again.output as string).endsWith(first.output as string)).toBe(true); // same document under the banner
    expect(db.all<{ action: string }>(`SELECT action FROM activity_log WHERE action IN ('PRINT','REPRINT')`).map((r) => r.action)).toEqual(['PRINT', 'REPRINT', 'REPRINT']);
    expect(() => db.run(`DELETE FROM print_log`)).toThrow(/append-only/);
  });

  it('T-B11-seal-roundtrip / tamper-fails / qr-fits-58mm', () => {
    const { db, pos } = make({ sln: 'MPOS-26-ABCDEF-7', min: '26010100001' });
    const s = pos.postSale({ userId: 'c1', online: true, lines: [food(11200)], payments: cash(11200) });
    const seal = JSON.parse(db.get<{ body: string }>(`SELECT body FROM ledger_entry WHERE seq = ?`, s.seq)!.body).seal as string;
    const v = verifySeal(seal);
    expect(v.valid).toBe(true);
    expect(v.claims).toMatchObject({ sln: 'MPOS-26-ABCDEF-7', tin: '123-456-789-00000', min: '26010100001', number: '00000001', amountDue: 11200, vat: 1200 });
    const [tag, msg, sig, key] = seal.split('.');
    const forged = btoa(atob(msg.replace(/-/g, '+').replace(/_/g, '/')).replace('|11200|', '|1120|')).replace(/=+$/, '');
    expect(verifySeal([tag, forged, sig, key].join('.')).valid).toBe(false);
    expect(verifySeal('nonsense').valid).toBe(false);
    expect(seal.length).toBeLessThanOrEqual(271); // QR version 10 (57 modules) at ECC M: prints at ~6 dots/module on 58mm
  });

  it('ESC/POS output initialises, prints the QR natively and cuts', () => {
    const { pos } = make({ paper: '58' });
    const s = pos.postSale({ userId: 'c1', online: true, lines: [food(10000)], payments: cash(10000) });
    const bytes = pos.print('c1', s.seq, 'escpos').output as Uint8Array;
    const hex = Buffer.from(bytes).toString('hex');
    expect(hex.startsWith('1b40')).toBe(true);
    expect(hex).toContain('1d286b0300315130'); // GS ( k: print stored QR
    expect(hex.endsWith('1d564200')).toBe(true); // partial cut
    expect(renderEscPos([{ k: 'text', text: 'Señor ₱' }], 32)).toContain(0x3f); // non-ASCII becomes "?", never garbage bytes
  });
});

describe('manual invoice fallback (C20)', () => {
  it('T-C20-manual-link: a booklet invoice is recorded, linked, counted on the Z, and never recorded twice', () => {
    const { pos } = make();
    const s = pos.postSale({ userId: 'c1', online: true, lines: [food(11200)], payments: cash(11200) });
    const m = pos.recordManualInvoice({ userId: 'sup1', online: true, manualNo: 'BKLT-000451', issuedOn: '2026-10-26', lines: [food(11200)], linkedInvoiceSeq: s.seq, buyer: { vatRegistered: true, name: 'ABC Trading', address: 'Mandaue', tin: '111222333' }, reason: 'Buyer needed full VAT details' });
    expect(flat(m.text)).toContain('MANUAL INVOICE RECORD');
    expect(flat(m.text)).toContain('Replaces system invoice 00000001');
    expect(code(() => pos.recordManualInvoice({ userId: 'sup1', online: true, manualNo: 'BKLT-000451', issuedOn: '2026-10-26', lines: [food(100)], reason: 'x' }))).toBe('DUPLICATE');
    const z = pos.zReading('sup1').reading;
    expect(z.manual).toEqual({ count: 1, amount: 11200, vat: 1200 });
    expect(z.netSales).toBe(11200); // a manual record does not add to system sales; eSales adjusts for it (Phase 4)
  });
});
