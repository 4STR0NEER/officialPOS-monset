import { expect, it } from 'vitest';
import { openCore, type Db } from '@monset/core';
import { openNodeDb } from '@monset/storage-node';
import { openMemoryDb } from '../src/index.ts';

// The tablet (sqlite-wasm) and the hub (node:sqlite) must agree byte for byte:
// same numbers, same hashes, same e-journal. Seal keys are random, so the seal is masked.
function day(db: Db) {
  let t = Date.parse('2026-10-26T01:00:00.000Z');
  const pos = openCore(db, { now: () => new Date((t += 1000)) });
  pos.initTerminal('owner', { terminalId: 'T1', deviceId: 'DEV-1', mode: 'LIVE', vatMode: 'VAT' });
  pos.configureSeller('owner', { registeredName: 'Parity Test Corp.', address: 'Cebu City', tin: '123456789' });
  const a = pos.postSale({ userId: 'c1', online: false, lines: [{ description: 'Sisig', qtyMilli: 2000, unitPrice: 22400, vatClass: 'VATABLE' }], payments: [{ method: 'CASH', amount: 50000 }], specialDiscounts: [{ type: 'SC', holder: { name: 'Lola', idNo: 'OSCA-1' }, diners: 3 }] });
  pos.postReversal({ userId: 'c1', online: true, type: 'REFUND', invoiceSeq: a.seq, reason: 'x', lines: [{ lineNo: 1, qtyMilli: 1000 }] });
  pos.issueSupplementary({ userId: 'c1', online: true, type: 'ORDER', lines: [{ description: 'Halo-halo', qtyMilli: 1000, unitPrice: 16000, vatClass: 'VATABLE' }] });
  pos.zReading('s1');
  expect(pos.verify().ok).toBe(true);
  const mask = (s: string) => s.replace(/Seal:\s+MPOS1[\s\S]*?(?=\n=+\n)/g, 'Seal: *');
  return {
    journal: mask(pos.exportJournal('owner')),
    accumulators: pos.state().accumulators,
    numbers: db.all(`SELECT doc_type, doc_no, series_reset FROM ledger_entry ORDER BY seq`),
  };
}

it('T-A2-engine-parity: sqlite-wasm and node:sqlite produce the same ledger and e-journal', async () => {
  const wasm = await openMemoryDb();
  const node = openNodeDb(':memory:');
  expect(day(wasm)).toEqual(day(node));
});
