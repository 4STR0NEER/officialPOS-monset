import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CreditCard, Minus, Plus, Printer, QrCode, Smartphone, Trash2, Wallet } from 'lucide-react';
import type { DiscountRule, Payment, SpecialDiscountInput, Totals } from '@monset/core';
import { api } from '../lib/api.ts';
import { parsePeso, peso, qty } from '../lib/format.ts';
import { printDocument } from '../lib/print.ts';
import { useSession } from '../lib/session.tsx';

export interface UiLine {
  id: string;
  name: string;
  detail?: string;
  qtyMilli: number;
  unitPrice: number;
  sent?: boolean;
}

/* ---------- lines ---------- */

export function LineList({ lines, onQty }: { lines: UiLine[]; onQty: (line: UiLine, qtyMilli: number) => void }) {
  const { t } = useSession();
  if (!lines.length) {
    return <p className="px-5 py-8 text-center text-sm text-ink-soft">{t('Nothing here yet')}</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {lines.map((l) => (
        <li key={l.id} className="flex items-center gap-2 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="leading-snug font-medium break-words">{l.name}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
              {l.detail && <span>{l.detail}</span>}
              <span className="num">{peso(l.unitPrice)}</span>
              {l.sent && <span className="rounded-sm bg-well px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap">{t('Sent')}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center rounded border border-line bg-paper">
            <button className="grid size-11 place-items-center text-ink-soft" aria-label={`Less ${l.name}`} onClick={() => onQty(l, Math.max(0, l.qtyMilli - 1000))}>
              {l.qtyMilli <= 1000 ? <Trash2 className="size-4" /> : <Minus className="size-4" />}
            </button>
            <span className="num w-7 text-center font-semibold">{qty(l.qtyMilli)}</span>
            <button className="grid size-11 place-items-center text-ink-soft" aria-label={`More ${l.name}`} onClick={() => onQty(l, l.qtyMilli + 1000)}>
              <Plus className="size-4" />
            </button>
          </div>
          <span className="num w-[4.5rem] shrink-0 text-right font-semibold">{peso(Math.round((l.qtyMilli * l.unitPrice) / 1000))}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- totals ---------- */

export function TotalsBlock({ totals, specials }: { totals: Totals | null; specials?: { type: string; label: string; holder: { name: string } }[] }) {
  const { t } = useSession();
  if (!totals) return null;
  const row = (label: string, v: number, strong = false) => (
    <div className={`flex justify-between ${strong ? 'text-xl font-bold' : 'text-sm text-ink-soft'}`}>
      <span>{label}</span>
      <span className="num">{peso(v)}</span>
    </div>
  );
  return (
    <div className="space-y-1 px-5 py-3">
      {row('Total sales', totals.gross)}
      {totals.vatExemption > 0 && row('Less VAT exemption', -totals.vatExemption)}
      {Object.entries(totals.discounts).map(([k, v]) => {
        const sd = specials?.find((s) => s.type === k);
        return <div key={k}>{row(`Less ${sd ? sd.label : k}`, -v)}</div>;
      })}
      <div className="pt-1">{row(t('Amount due'), totals.net, true)}</div>
    </div>
  );
}

/* ---------- senior / PWD / NAAC / solo parent ---------- */

export function DiscountForm({
  lines,
  guests,
  current,
  onSave,
  onCancel,
}: {
  lines: UiLine[];
  guests: number;
  current: SpecialDiscountInput[];
  onSave: (s: SpecialDiscountInput[]) => void;
  onCancel: () => void;
}) {
  const { t } = useSession();
  const [types, setTypes] = useState<DiscountRule[]>([]);
  const [type, setType] = useState('SC');
  const [name, setName] = useState('');
  const [idType, setIdType] = useState('');
  const [idNo, setIdNo] = useState('');
  const [tin, setTin] = useState('');
  const [basis, setBasis] = useState<'share' | 'items'>(guests > 1 ? 'share' : 'items');
  const [diners, setDiners] = useState(Math.max(1, guests));
  const [picked, setPicked] = useState<Record<number, number>>({});
  useEffect(() => {
    api.core.discountTypes().then((all) => {
      const order = ['SC', 'PWD', 'NAAC', 'SOLO'];
      const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : 10);
      const d = [...all].sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
      setTypes(d);
      setIdType(d.find((x) => x.code === 'SC')?.idTypes[0] ?? '');
    });
  }, []);
  const rule = types.find((x) => x.code === type);
  const items = Object.entries(picked).filter(([, q]) => q > 0).map(([n, q]) => ({ lineNo: Number(n), qtyMilli: q }));
  const valid = name.trim() && idNo.trim() && (basis === 'share' ? diners >= 1 : items.length > 0);

  return (
    <div className="space-y-4 px-5 py-4">
      {current.length > 0 && (
        <ul className="space-y-2">
          {current.map((s, i) => (
            <li key={i} className="flex items-center justify-between rounded bg-film-2 px-3 py-2 text-sm">
              <span>
                <b>{s.type}</b> {s.holder.name} · {s.holder.idNo}
              </span>
              <button className="btn btn-quiet min-h-9 px-2 text-pin" onClick={() => onSave(current.filter((_, j) => j !== i))}>
                {t('Remove discount')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Discount type">
        {types.map((d) => (
          <button
            key={d.code}
            role="radio"
            aria-checked={type === d.code}
            onClick={() => {
              setType(d.code);
              setIdType(d.idTypes[0] ?? '');
            }}
            className={`btn min-h-12 flex-col gap-0 px-2 text-sm leading-tight ${type === d.code ? 'btn-on' : 'btn-secondary'}`}
          >
            <span>
              {d.code.replace('_BNPC', '')} <span className="num font-normal">{d.rateBp / 100}%</span>
            </span>
            {d.code.endsWith('_BNPC') && <span className="text-xs font-normal text-ink-soft">basic goods</span>}
          </button>
        ))}
      </div>
      {rule && <p className="text-sm text-ink-soft">{rule.label}{rule.vatExempt ? ' · VAT removed first, then discount' : ''}{rule.categories ? ` · only ${rule.categories.join(', ').toLowerCase().replace(/_/g, ' ')}` : ''}</p>}
      <label className="block text-sm font-medium">
        {t('Name')}
        <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm font-medium">
          {t('ID type')}
          <select className="field mt-1" value={idType} onChange={(e) => setIdType(e.target.value)}>
            {rule?.idTypes.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">
          {t('ID number')}
          <input className="field mt-1" value={idNo} onChange={(e) => setIdNo(e.target.value)} autoComplete="off" />
        </label>
      </div>
      <label className="block text-sm font-medium">
        {t('TIN (optional)')}
        <input className="field mt-1" value={tin} onChange={(e) => setTin(e.target.value)} inputMode="numeric" autoComplete="off" />
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        <button className={`btn min-h-11 ${basis === 'share' ? 'btn-on' : 'btn-secondary'}`} onClick={() => setBasis('share')}>
          {t('Share of the bill')}
        </button>
        <button className={`btn min-h-11 ${basis === 'items' ? 'btn-on' : 'btn-secondary'}`} onClick={() => setBasis('items')}>
          {t('Their own items')}
        </button>
      </div>
      {basis === 'share' ? (
        <div className="flex items-center justify-between rounded bg-film-2 px-3 py-2">
          <span className="text-sm">
            1 / <b className="num">{diners}</b> {t('diners sharing')}
          </span>
          <Stepper value={diners} min={1} onChange={setDiners} />
        </div>
      ) : (
        <ul className="divide-y divide-line rounded border border-line">
          {lines.map((l, i) => (
            <li key={l.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
              <span className="truncate">{l.name}</span>
              <Stepper value={(picked[i + 1] ?? 0) / 1000} min={0} max={l.qtyMilli / 1000} onChange={(v) => setPicked({ ...picked, [i + 1]: v * 1000 })} />
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button className="btn btn-secondary" onClick={onCancel}>
          {t('Back')}
        </button>
        <button
          className="btn btn-primary"
          disabled={!valid}
          onClick={() =>
            onSave([
              ...current,
              {
                type,
                holder: { name: name.trim(), idNo: idNo.trim(), idType: idType || undefined, tin: tin.trim() || undefined },
                ...(basis === 'share' ? { diners } : { items }),
              },
            ])
          }
        >
          {t('Apply discount')}
        </button>
      </div>
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex items-center rounded border border-line bg-paper">
      <button className="grid size-10 place-items-center text-ink-soft disabled:opacity-40" disabled={value <= min} aria-label="Less" onClick={() => onChange(value - 1)}>
        <Minus className="size-4" />
      </button>
      <span className="num w-8 text-center font-semibold">{value}</span>
      <button className="grid size-10 place-items-center text-ink-soft disabled:opacity-40" disabled={value >= max} aria-label="More" onClick={() => onChange(value + 1)}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/* ---------- payment ---------- */

// Payment providers are plug-ins. Phase 3 records what the cashier collected on the card terminal
// or e-wallet app; a live gateway (PayMongo, etc.) slots in behind the same shape later.
export interface PaymentProvider {
  method: string;
  label: string;
  Icon: typeof Wallet;
  needsRef: boolean;
}
export const PROVIDERS: PaymentProvider[] = [
  { method: 'CASH', label: 'Cash', Icon: Wallet, needsRef: false },
  { method: 'CARD', label: 'Card', Icon: CreditCard, needsRef: true },
  { method: 'QRPH', label: 'QR Ph', Icon: QrCode, needsRef: true },
  { method: 'GCASH', label: 'GCash', Icon: Smartphone, needsRef: true },
  { method: 'MAYA', label: 'Maya', Icon: Smartphone, needsRef: true },
];

export function PayPanel({ due, onPay, onBack }: { due: number; onPay: (p: Payment[]) => Promise<void>; onBack: () => void }) {
  const { t } = useSession();
  const [tenders, setTenders] = useState<Payment[]>([]);
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const paid = tenders.reduce((a, p) => a + p.amount, 0);
  const left = Math.max(0, due - paid);
  const provider = PROVIDERS.find((p) => p.method === method)!;
  const typed = parsePeso(amount);
  const quick = useMemo(() => {
    const set = new Set([left, ...[100, 200, 500, 1000].map((b) => Math.ceil(left / (b * 100)) * b * 100)]);
    return [...set].filter((v) => v >= left).slice(0, 4);
  }, [left]);

  const add = (value: number) => {
    if (!value) return;
    setTenders([...tenders, { method, amount: value, ref: provider.needsRef ? ref.trim() : undefined }]);
    setAmount('');
    setRef('');
  };
  const canAdd = typed != null && typed > 0 && (!provider.needsRef || ref.trim()) && (method === 'CASH' || typed <= left);
  const done = paid >= due && tenders.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="bg-night px-5 py-4 text-film">
        <p className="display num text-4xl">
          {peso(due)} <span className="text-base font-medium tracking-normal text-mist">{t('Amount due').toLowerCase()}</span>
        </p>
        {paid > 0 && (
          <p className="num mt-1 text-sm text-mist">
            {t('Received')} {peso(paid)} · {done ? `${t('Change')} ${peso(paid - due)}` : `left ${peso(left)}`}
          </p>
        )}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Tender">
          {PROVIDERS.map(({ method: m, label, Icon }) => (
            <button key={m} role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={`btn min-h-16 flex-col gap-1 px-1 text-xs ${method === m ? 'btn-on' : 'btn-secondary'}`}>
              <Icon className="size-5" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </div>
        {!done && (
          <>
            <div className="grid grid-cols-4 gap-1.5">
              {(method === 'CASH' ? quick : [left]).map((v) => (
                <button key={v} className="btn btn-secondary num min-h-12 px-1" disabled={provider.needsRef && !ref.trim()} onClick={() => add(v)}>
                  {v === left ? 'Exact' : peso(v).replace('.00', '')}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input className="field num text-lg" inputMode="decimal" placeholder={peso(left)} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
              <button className="btn btn-night shrink-0" disabled={!canAdd} onClick={() => add(typed!)}>
                Add
              </button>
            </div>
            {provider.needsRef && (
              <label className="block text-sm font-medium">
                Reference / approval no. from the {provider.label} terminal or app
                <input className="field mt-1" value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" />
              </label>
            )}
          </>
        )}
        {tenders.length > 0 && (
          <ul className="divide-y divide-line rounded border border-line bg-paper">
            {tenders.map((p, i) => (
              <li key={i} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm">
                  {PROVIDERS.find((x) => x.method === p.method)?.label} {p.ref && <span className="text-ink-soft">· {p.ref}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="num font-semibold">{peso(p.amount)}</span>
                  <button className="grid size-9 place-items-center text-ink-soft" aria-label="Remove payment" onClick={() => setTenders(tenders.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid grid-cols-[1fr_2fr] gap-2 border-t border-line px-5 py-4">
        <button className="btn btn-secondary" onClick={onBack} disabled={busy}>
          {t('Back')}
        </button>
        <button
          className="btn btn-primary min-h-14 text-lg"
          disabled={!done || busy}
          onClick={async () => {
            setBusy(true);
            await onPay(tenders);
            setBusy(false);
          }}
        >
          {t('Complete sale')}
        </button>
      </div>
    </div>
  );
}

/* ---------- after payment ---------- */

export function DoneSheet({ number, seq, change, onClose }: { number: string; seq: number; change: number; onClose: () => void }) {
  const { t, user, run } = useSession();
  return (
    <div className="slide-in flex h-full flex-col items-stretch justify-center gap-6 px-6 text-center">
      <BadgeCheck className="mx-auto size-12 text-ok" strokeWidth={1.5} />
      <div>
        <p className="display num text-3xl">Invoice {number}</p>
        <p className="mt-1 text-ink-soft">{t('Invoice issued')}. Hand it over or print it.</p>
      </div>
      {change > 0 && (
        <div className="rounded bg-night px-4 py-5 text-film">
          <p className="display num text-5xl">{peso(change)}</p>
          <p className="mt-1 text-mist">{t('Change')}</p>
        </div>
      )}
      <div className="grid gap-2">
        <button className="btn btn-secondary min-h-14" onClick={() => run(() => printDocument(user!.id, seq))}>
          <Printer className="size-5" /> {t('Print invoice')}
        </button>
        <button className="btn btn-primary min-h-14" onClick={onClose}>
          {t('Done')}
        </button>
      </div>
    </div>
  );
}
