import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, Printer, Search, WifiOff } from 'lucide-react';
import { api } from '../lib/api.ts';
import { localDate, localTime, parsePeso, peso, qty } from '../lib/format.ts';
import { printDocument } from '../lib/print.ts';
import { useSession } from '../lib/session.tsx';
import { Stepper } from '../components/order.tsx';
import { ReceiptText } from './Readings.tsx';

type Doc = Awaited<ReturnType<typeof api.core.documents>>[number];
type Detail = Awaited<ReturnType<typeof api.core.document>>;

const FILTERS: { label: string; type?: string }[] = [
  { label: 'All' },
  { label: 'Invoices', type: 'INVOICE' },
  { label: 'Voids', type: 'VOID' },
  { label: 'Refunds', type: 'REFUND' },
  { label: 'Returns', type: 'RETURN' },
  { label: 'Order slips', type: 'ORDER' },
  { label: 'Manual', type: 'MANUAL' },
  { label: 'Z', type: 'Z' },
];

export function Journal() {
  const { t, user, run } = useSession();
  const [filter, setFilter] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [open, setOpen] = useState<Detail | null>(null);
  const [mode, setMode] = useState<'view' | 'void' | 'refund' | 'return' | 'manual'>('view');
  const load = useCallback(() => api.core.documents({ type: filter, search: search.trim() || undefined, limit: 200 }).then(setDocs), [filter, search]);
  useEffect(() => {
    load();
  }, [load]);
  const current = docs.find((d) => d.seq === open?.seq);

  return (
    <div className="grid h-full flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] overflow-hidden">
      <section className="flex min-h-0 flex-col border-r border-line">
        <div className="flex items-center gap-3 border-b border-line bg-paper px-5 py-3">
          <h1 className="display mr-2 text-2xl">{t('Journal')}</h1>
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" />
            <input className="field num min-h-11 pl-9" placeholder="Document no." value={search} onChange={(e) => setSearch(e.target.value)} inputMode="numeric" />
          </label>
          <button className="btn btn-secondary min-h-11" onClick={() => { setOpen(null); setMode('manual'); }}>
            <FilePlus2 className="size-4" /> Manual invoice
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-line px-5 py-2">
          {FILTERS.map((f) => (
            <button key={f.label} aria-pressed={filter === f.type} onClick={() => setFilter(f.type)} className={`btn min-h-10 shrink-0 px-3 text-sm ${filter === f.type ? 'btn-on' : 'btn-quiet'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-film-2 text-left">
              <tr className="map-label text-ink-soft">
                <th className="px-5 py-2.5 font-[inherit]">Document</th>
                <th className="py-2.5 font-[inherit]">Date</th>
                <th className="py-2.5 font-[inherit]">User</th>
                <th className="px-5 py-2.5 text-right font-[inherit]">Amount</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr
                  key={d.seq}
                  onClick={() => api.core.document(d.seq).then((x) => { setOpen(x); setMode('view'); })}
                  className={`cursor-pointer border-b border-line ${open?.seq === d.seq ? 'bg-contour-wash' : 'hover:bg-film-2'}`}
                >
                  <td className="px-5 py-2.5">
                    <span className="font-semibold">{d.docType}</span> <span className="num">{d.number}</span>
                    {d.reversed && <span className="ml-2 rounded-sm bg-pin-wash px-1.5 py-0.5 text-xs font-semibold text-pin">reversed</span>}
                    {d.offline && <WifiOff className="ml-2 inline size-3.5 text-ink-soft" aria-label="issued offline" />}
                  </td>
                  <td className="num py-2.5 text-ink-soft">{localDate(d.issuedAt)} {localTime(d.issuedAt)}</td>
                  <td className="py-2.5 text-ink-soft">{d.userId.slice(0, 8)}</td>
                  <td className="num px-5 py-2.5 text-right">{d.amount == null ? '' : peso(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!docs.length && <p className="py-12 text-center text-ink-soft">No documents yet. Every invoice, slip and reading appears here the moment it is issued.</p>}
        </div>
      </section>

      <section className="flex min-h-0 flex-col p-5">
        {mode === 'manual' ? (
          <ManualInvoice onDone={() => { setMode('view'); load(); }} />
        ) : open ? (
          mode === 'view' ? (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                <button className="btn btn-secondary min-h-11" onClick={() => run(async () => { const re = await printDocument(user!.id, open.seq); if (re) load(); })}>
                  <Printer className="size-4" /> {t('Reprint')}
                </button>
                {open.docType === 'INVOICE' && current && !current.reversed && current.sameDay && (
                  <button className="btn btn-secondary min-h-11 text-pin" onClick={() => setMode('void')}>{t('Void')}</button>
                )}
                {open.docType === 'INVOICE' && (
                  <>
                    <button className="btn btn-secondary min-h-11" onClick={() => setMode('refund')}>{t('Refund')}</button>
                    <button className="btn btn-secondary min-h-11" onClick={() => setMode('return')}>{t('Return')}</button>
                  </>
                )}
              </div>
              <ReceiptText text={open.text} />
            </>
          ) : (
            <Reverse doc={open} kind={mode as 'void' | 'refund' | 'return'} onDone={async (seq) => { if (seq) { setOpen(await api.core.document(seq)); } setMode('view'); load(); }} />
          )
        ) : (
          <div className="grid flex-1 place-items-center rounded border border-dashed border-line text-center text-ink-soft">
            <p className="max-w-xs">Choose a document to see it exactly as issued, reprint it, or correct an invoice.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function Reverse({ doc, kind, onDone }: { doc: Detail; kind: 'void' | 'refund' | 'return'; onDone: (seq?: number) => void }) {
  const { user, online, run, askPin } = useSession();
  const [reason, setReason] = useState('');
  const [take, setTake] = useState<Record<number, number>>({});
  const items = Object.entries(take).filter(([, q]) => q > 0).map(([n, q]) => ({ lineNo: Number(n), qtyMilli: q }));
  const ok = reason.trim() && (kind === 'void' || items.length);
  return (
    <div className="space-y-4 overflow-y-auto">
      <h2 className="display text-2xl">
        {kind === 'void' ? 'Void' : kind === 'refund' ? 'Refund' : 'Return'} invoice <span className="num">{doc.number}</span>
      </h2>
      <p className="text-ink-soft">
        {kind === 'void'
          ? 'The whole invoice is cancelled by a separate VOID document. The invoice itself stays in the journal, unchanged.'
          : 'Choose what comes back. A separate document is issued; the original invoice is never changed.'}
      </p>
      {kind !== 'void' && (
        <ul className="divide-y divide-line rounded border border-line bg-paper">
          {doc.lines.map((l) => (
            <li key={l.lineNo} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="truncate">{l.description} <span className="num text-ink-soft">× {qty(l.qtyMilli)}</span></span>
              <Stepper value={(take[l.lineNo] ?? 0) / 1000} max={Math.floor(l.qtyMilli / 1000)} onChange={(v) => setTake({ ...take, [l.lineNo]: v * 1000 })} />
            </li>
          ))}
        </ul>
      )}
      <label className="block text-sm font-medium">
        Reason
        <input className="field mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-secondary" onClick={() => onDone()}>Back</button>
        <button
          className="btn btn-danger"
          disabled={!ok}
          onClick={async () => {
            const pin = await askPin(`${kind} invoice ${doc.number}`);
            if (!pin) return;
            const sup = await run(() => api.sell.approve(pin, `${kind} ${doc.number}`));
            if (!sup) return;
            const r = await run(() =>
              api.core.postReversal({ userId: user!.id, online, type: kind.toUpperCase() as 'VOID', invoiceSeq: doc.seq, reason: reason.trim(), approvedBy: sup.id, lines: kind === 'void' ? undefined : items }),
            );
            if (r) onDone(r.seq);
          }}
        >
          Issue {kind}
        </button>
      </div>
    </div>
  );
}

/** Record an invoice written by hand from the BIR-registered booklet (outage, or buyer details the system cannot take). */
function ManualInvoice({ onDone }: { onDone: () => void }) {
  const { user, online, run, askPin, toast } = useSession();
  const [f, setF] = useState({ manualNo: '', issuedOn: new Date().toISOString().slice(0, 10), description: '', amount: '', vatClass: 'VATABLE', buyer: '', tin: '', reason: '', link: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const amount = parsePeso(f.amount);
  return (
    <div className="space-y-3 overflow-y-auto">
      <h2 className="display text-2xl">Record a manual invoice</h2>
      <p className="text-ink-soft">For an invoice written from the BIR-registered booklet. It is logged, linked and counted on the Z reading, never added to system sales.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-medium">Booklet invoice no.<input className="field mt-1" value={f.manualNo} onChange={set('manualNo')} /></label>
        <label className="text-sm font-medium">Date written<input type="date" className="field mt-1" value={f.issuedOn} onChange={set('issuedOn')} /></label>
      </div>
      <label className="block text-sm font-medium">What was sold<input className="field mt-1" value={f.description} onChange={set('description')} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-medium">Amount (VAT-inclusive)<input className="field num mt-1" inputMode="decimal" value={f.amount} onChange={set('amount')} /></label>
        <label className="text-sm font-medium">VAT class
          <select className="field mt-1" value={f.vatClass} onChange={set('vatClass')}><option>VATABLE</option><option>EXEMPT</option><option>ZERO</option></select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-medium">Buyer<input className="field mt-1" value={f.buyer} onChange={set('buyer')} /></label>
        <label className="text-sm font-medium">Buyer TIN<input className="field mt-1" value={f.tin} onChange={set('tin')} /></label>
      </div>
      <label className="block text-sm font-medium">Replaces system invoice no. (optional)<input className="field num mt-1" value={f.link} onChange={set('link')} /></label>
      <label className="block text-sm font-medium">Reason<input className="field mt-1" value={f.reason} onChange={set('reason')} /></label>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button className="btn btn-secondary" onClick={onDone}>Back</button>
        <button
          className="btn btn-primary"
          disabled={!f.manualNo || !f.description || !amount || !f.reason}
          onClick={async () => {
            const pin = await askPin(`Record manual invoice ${f.manualNo}`);
            if (!pin || !(await run(() => api.sell.approve(pin, 'manual invoice')))) return;
            let linked: number | undefined;
            if (f.link.trim()) {
              const d = (await api.core.documents({ type: 'INVOICE', search: f.link.trim(), limit: 5 })).find((x) => x.number.endsWith(f.link.trim()));
              if (!d) return toast(`No system invoice ${f.link}`);
              linked = d.seq;
            }
            const r = await run(() =>
              api.core.recordManualInvoice({
                userId: user!.id, online, manualNo: f.manualNo, issuedOn: f.issuedOn, reason: f.reason, linkedInvoiceSeq: linked,
                lines: [{ description: f.description, qtyMilli: 1000, unitPrice: amount!, vatClass: f.vatClass as 'VATABLE' }],
                buyer: f.buyer || f.tin ? { name: f.buyer || undefined, tin: f.tin || undefined } : undefined,
              }),
            );
            if (r) {
              toast(`Manual invoice recorded as ${r.number}`, 'ok');
              onDone();
            }
          }}
        >
          Record
        </button>
      </div>
    </div>
  );
}
