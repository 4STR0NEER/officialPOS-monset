// Child process for crash and concurrency tests.
// Usage: node writer.ts <dbPath> <count|forever>
// Prints "OK <seq>" only after a sale has committed. That is the "confirmed to the cashier" moment.
import { openCore } from '@monset/core';
import { openNodeDb } from '../src/index.ts';

const [dbPath, howMany] = process.argv.slice(2);
const pos = openCore(openNodeDb(dbPath), { clockToleranceMs: 60_000 });
const limit = howMany === 'forever' ? Infinity : Number(howMany);
let last = 0;
for (let i = 0; i < limit; i++) {
  const s = pos.postSale({
    userId: `pid${process.pid}`,
    online: i % 3 !== 0,
    lines: [
      { description: 'Item A', qtyMilli: 1000 + (i % 7) * 250, unitPrice: 1999, vatClass: 'VATABLE' },
      { description: 'Item B', qtyMilli: 1000, unitPrice: 500, vatClass: 'EXEMPT' },
    ],
    payments: [{ method: 'CASH', amount: 10_000 }],
  });
  process.stdout.write(`OK ${s.seq}\n`);
  if (i % 5 === 4) {
    const r = pos.postReversal({ userId: 'sup', online: true, type: 'REFUND', invoiceSeq: last || s.seq, reason: 'crash test', lines: [{ lineNo: 2, qtyMilli: 1000 }] });
    process.stdout.write(`OK ${r.seq}\n`);
  }
  last = s.seq;
}
