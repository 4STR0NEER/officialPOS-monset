import { emptyTotals, type Totals } from './totals.ts';
import type { EntryRow } from './verify.ts';

export interface Bucket {
  count: number;
  amount: number;
  vat: number;
}

export interface Reading {
  kind: 'X' | 'Z';
  fromSeq: number; // first ledger seq covered (inclusive)
  toSeq: number; // last ledger seq covered (inclusive); fromSeq > toSeq means an empty period
  beginInvoiceNo: number | null;
  endInvoiceNo: number | null;
  beginGrandTotal: number;
  beginResetCounter: number;
  endGrandTotal: number;
  endResetCounter: number;
  zCounter: number; // Z: this reading's counter. X: counter of the last Z.
  invoiceCount: number;
  sales: Totals; // from invoices, before reversals
  voids: Bucket;
  refunds: Bucket;
  returns: Bucket;
  manual: Bucket; // manual invoices recorded (outage / VAT buyer fallback); excluded from netSales
  netSales: number; // sales.net minus voids, refunds and returns
  payments: Record<string, number>; // collected per method, net of change and refunds; sums to netSales
}

interface InvoiceBody {
  totals: Totals;
  payments: { method: string; amount: number }[];
  change: number;
}
interface ReversalBody {
  totals: Totals;
  refunds: { method: string; amount: number }[];
}

const bucket = (): Bucket => ({ count: 0, amount: 0, vat: 0 });
const add = (m: Record<string, number>, k: string, v: number) => {
  m[k] = (m[k] ?? 0) + v;
};

/** Summarise the ledger rows since the last Z. Pure, so tests can recompute it independently. */
export function summarize(
  kind: 'X' | 'Z',
  rows: EntryRow[],
  start: { fromSeq: number; grandTotal: number; resetCounter: number },
  end: { grandTotal: number; resetCounter: number; zCounter: number },
): Reading {
  const r: Reading = {
    kind,
    fromSeq: start.fromSeq,
    toSeq: rows.length ? rows[rows.length - 1].seq : start.fromSeq - 1,
    beginInvoiceNo: null,
    endInvoiceNo: null,
    beginGrandTotal: start.grandTotal,
    beginResetCounter: start.resetCounter,
    endGrandTotal: end.grandTotal,
    endResetCounter: end.resetCounter,
    zCounter: end.zCounter,
    invoiceCount: 0,
    sales: emptyTotals(),
    voids: bucket(),
    refunds: bucket(),
    returns: bucket(),
    manual: bucket(),
    netSales: 0,
    payments: {},
  };
  for (const row of rows) {
    if (row.doc_type === 'INVOICE') {
      const b = JSON.parse(row.body) as InvoiceBody;
      r.beginInvoiceNo ??= row.doc_no;
      r.endInvoiceNo = row.doc_no;
      r.invoiceCount += 1;
      const s = r.sales;
      s.gross += b.totals.gross;
      s.discount += b.totals.discount;
      s.vatExemption += b.totals.vatExemption ?? 0;
      s.net += b.totals.net;
      s.vatable += b.totals.vatable;
      s.vat += b.totals.vat;
      s.exempt += b.totals.exempt;
      s.zeroRated += b.totals.zeroRated;
      s.nonVatTaxable += b.totals.nonVatTaxable;
      for (const [k, v] of Object.entries(b.totals.discounts)) add(s.discounts, k, v);
      for (const p of b.payments) add(r.payments, p.method, p.amount);
      if (b.change) add(r.payments, 'CASH', -b.change);
    } else if (row.doc_type === 'VOID' || row.doc_type === 'REFUND' || row.doc_type === 'RETURN') {
      const b = JSON.parse(row.body) as ReversalBody;
      const k = row.doc_type === 'VOID' ? r.voids : row.doc_type === 'REFUND' ? r.refunds : r.returns;
      k.count += 1;
      k.amount += b.totals.net;
      k.vat += b.totals.vat;
      for (const p of b.refunds) add(r.payments, p.method, -p.amount);
    } else if (row.doc_type === 'MANUAL') {
      const b = JSON.parse(row.body) as ReversalBody;
      r.manual.count += 1;
      r.manual.amount += b.totals.net;
      r.manual.vat += b.totals.vat;
    }
  }
  r.netSales = r.sales.net - r.voids.amount - r.refunds.amount - r.returns.amount;
  return r;
}
