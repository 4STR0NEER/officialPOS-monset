import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import type { Reading } from '@monset/core';
import { api } from '../lib/api.ts';
import { peso } from '../lib/format.ts';
import { printDocument } from '../lib/print.ts';
import { useSession } from '../lib/session.tsx';

export function Readings() {
  const { t, user, online, run, askPin, toast } = useSession();
  const [today, setToday] = useState<Reading | null>(null);
  const [last, setLast] = useState<{ seq: number; text: string } | null>(null);
  const load = () => api.core.peekReading().then(setToday);
  useEffect(() => {
    load();
  }, []);

  const issue = async (kind: 'X' | 'Z') => {
    if (kind === 'Z') {
      const pin = await askPin('Close the business day (Z reading)');
      if (!pin) return;
      const sup = await run(() => api.sell.approve(pin, 'Z reading'));
      if (!sup) return;
    }
    const r = await run(() => (kind === 'X' ? api.core.xReading(user!.id, online) : api.core.zReading(user!.id, online)));
    if (r) {
      setLast({ seq: r.posted.seq, text: r.posted.text });
      toast(`${kind} reading ${r.posted.number} issued`, 'ok');
      load();
    }
  };

  const row = (label: string, v: number, strong = false) => (
    <div className={`flex justify-between border-b border-line py-2 ${strong ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="num">{peso(v)}</span>
    </div>
  );

  return (
    <div className="grid h-full flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 overflow-hidden p-6">
      <section className="flex min-h-0 flex-col overflow-y-auto">
        <h1 className="display text-3xl">{t('Readings')}</h1>
        <p className="mt-1 text-ink-soft">Today so far, since the last Z reading. Nothing below is issued until you press a button.</p>
        {today && (
          <div className="mt-5 rounded bg-paper px-5 py-3 shadow-[var(--shadow-card)]">
            {row('Gross sales', today.sales.gross)}
            {today.sales.vatExemption > 0 && row('Less VAT exemption', -today.sales.vatExemption)}
            {Object.entries(today.sales.discounts).map(([k, v]) => <div key={k}>{row(`Less ${k} discount`, -v)}</div>)}
            {row(`Voids (${today.voids.count})`, -today.voids.amount)}
            {row(`Refunds (${today.refunds.count})`, -today.refunds.amount)}
            {row(`Returns (${today.returns.count})`, -today.returns.amount)}
            {row('Net sales', today.netSales, true)}
            <div className="grid grid-cols-2 gap-x-6 pt-2 text-sm text-ink-soft">
              {Object.entries(today.payments).map(([k, v]) => (
                <div key={k} className="flex justify-between py-1">
                  <span>{k}</span>
                  <span className="num">{peso(v)}</span>
                </div>
              ))}
            </div>
            <p className="num pt-2 text-sm text-ink-soft">
              {today.invoiceCount} {today.invoiceCount === 1 ? 'invoice' : 'invoices'} · grand total {peso(today.endGrandTotal)} · Z counter {today.zCounter}
            </p>
          </div>
        )}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button className="btn btn-secondary min-h-20 flex-col gap-0" onClick={() => issue('X')}>
            <span className="display text-xl">X reading</span>
            <span className="text-sm font-normal text-ink-soft">Mid-shift, the day stays open</span>
          </button>
          <button className="btn btn-night min-h-20 flex-col gap-0" onClick={() => issue('Z')}>
            <span className="display text-xl">Z reading</span>
            <span className="text-sm font-normal text-mist">Closes the day · supervisor PIN</span>
          </button>
        </div>
      </section>
      <section className="flex min-h-0 flex-col">
        {last ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Issued reading</h2>
              <button className="btn btn-secondary min-h-10" onClick={() => run(() => printDocument(user!.id, last.seq))}>
                <Printer className="size-4" /> Print
              </button>
            </div>
            <ReceiptText text={last.text} />
          </>
        ) : (
          <div className="grid flex-1 place-items-center rounded border border-dashed border-line text-center text-ink-soft">
            <p className="max-w-xs">An issued X or Z reading shows here exactly as it prints and as the e-journal keeps it.</p>
          </div>
        )}
      </section>
    </div>
  );
}

/** A document as printed: fixed-width text, so monospace is the honest face here. */
export function ReceiptText({ text }: { text: string }) {
  return (
    <pre className="min-h-0 flex-1 overflow-auto rounded bg-paper px-6 py-5 font-mono text-[0.8rem] leading-[1.45] text-ink shadow-[var(--shadow-card)]">
      {text}
    </pre>
  );
}
