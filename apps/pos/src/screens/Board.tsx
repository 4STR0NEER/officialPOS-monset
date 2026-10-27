import { useCallback, useEffect, useState } from 'react';
import { ChefHat, ConciergeBell, Ellipsis, Plus, Receipt, UserRound, Users, X } from 'lucide-react';
import type { Reading } from '@monset/core';
import type { CheckView, Stage } from '@monset/sell';
import { api } from '../lib/api.ts';
import { businessDateLabel, peso } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';
import { AgeRings, ageTone, ringLabel } from '../components/AgeRings.tsx';
import { MenuPicker } from '../components/MenuPicker.tsx';
import { DiscountForm, DoneSheet, LineList, PayPanel, Stepper, TotalsBlock, type UiLine } from '../components/order.tsx';

type Menu = Awaited<ReturnType<typeof api.sell.menu>>;
type CheckData = Awaited<ReturnType<typeof api.sell.check>>;

const COLUMNS: { stage: Stage; label: string; empty: string }[] = [
  { stage: 'seated', label: 'Seated', empty: 'Tap New check to seat a table.' },
  { stage: 'ordered', label: 'Ordered', empty: 'Checks move here once the kitchen has the order.' },
  { stage: 'served', label: 'Served', empty: 'Mark a check served when the food is on the table.' },
  { stage: 'billout', label: 'Bill out', empty: 'Tables that asked for the bill wait here to pay.' },
];

export function Board() {
  const { t, user } = useSession();
  const [checks, setChecks] = useState<CheckView[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [today, setToday] = useState<Reading | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    const [b, r] = await Promise.all([api.sell.board(), api.core.peekReading()]);
    setChecks(b);
    setToday(r);
  }, []);
  useEffect(() => {
    load();
    api.sell.menu().then(setMenu);
    const i = setInterval(load, 30_000); // keeps minutes-open (and the rings) current
    return () => clearInterval(i);
  }, [load]);
  const changed = () => {
    setTick((n) => n + 1);
    return load();
  };

  const drawerOpen = creating || !!selected;
  const late = checks.filter((c) => ageTone(c.minutesOpen) === 'late').length;
  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-6 border-b border-line bg-paper px-5">
          <div>
            <p className="map-label text-ink-soft">{businessDateLabel()}</p>
            <p className="font-semibold">
              <span className="num">{checks.length}</span> {checks.length === 1 ? t('open check') : t('open checks')}
              {late > 0 && (
                <span className="num ml-2 rounded-sm bg-pin px-1.5 py-0.5 text-sm text-white">
                  {late} {t('late')}
                </span>
              )}
            </p>
          </div>
          <div className="border-l border-line pl-6">
            <p className="map-label text-ink-soft">{t('Net sales today')}</p>
            <p className="num font-semibold">{today ? peso(today.netSales) : '–'}</p>
          </div>
          <button
            className="btn btn-primary ml-auto min-h-12 px-5"
            onClick={() => {
              setSelected(null);
              setPicking(false);
              setCreating(true);
            }}
          >
            <Plus className="size-5" /> {t('New check')}
          </button>
        </header>

        {picking && selected && menu ? (
          <MenuPicker
            categories={menu.categories}
            items={menu.items}
            onClose={() => setPicking(false)}
            onPick={(item, modifiers) => api.sell.addItem(user!.id, selected, item.id, { modifiers }).then(changed)}
            onBarcode={async (code) => {
              const it = await api.sell.itemByBarcode(code);
              if (it) await api.sell.addItem(user!.id, selected, it.id).then(changed);
            }}
          />
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-4 gap-2 p-3 xl:gap-3 xl:p-4">
            {COLUMNS.map((col) => {
              const list = checks.filter((c) => c.stage === col.stage);
              const lateHere = list.filter((c) => ageTone(c.minutesOpen) === 'late').length;
              return (
                <section key={col.stage} className="@container flex min-h-0 min-w-0 flex-col rounded bg-well/70" aria-label={t(col.label)}>
                  <h2 className="flex items-center justify-between gap-1 px-3 pt-3 pb-2">
                    <span className="map-label truncate tracking-[0.04em] text-ink-soft @[176px]:tracking-[0.12em]">{t(col.label)}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {lateHere > 0 && <span className="num rounded-full bg-pin px-2 py-0.5 text-sm font-semibold text-white">{lateHere} {t('late')}</span>}
                      <span className="num rounded-full bg-paper px-2 py-0.5 text-sm font-semibold">{list.length}</span>
                    </span>
                  </h2>
                  <ul className="grid flex-1 auto-rows-min grid-cols-1 gap-2 overflow-y-auto px-2 pb-2 @[440px]:grid-cols-2">
                    {list.map((c) => (
                      <li key={c.id}>
                        <CheckCard
                          c={c}
                          selected={selected === c.id}
                          onClick={() => {
                            setCreating(false);
                            setPicking(false);
                            setSelected(c.id);
                          }}
                        />
                      </li>
                    ))}
                    {!list.length && <li className="col-span-full px-2 py-6 text-center text-sm text-ink-soft">{t(col.empty)}</li>}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {drawerOpen && (
        <aside key={selected ?? 'new'} className="slide-in flex w-[clamp(352px,34vw,420px)] shrink-0 flex-col border-l border-line bg-paper shadow-[var(--shadow-drawer)]" aria-label="Check">
          {creating ? (
            <NewCheck
              menu={menu}
              busyTables={checks.map((c) => c.tableId).filter(Boolean) as string[]}
              onCancel={() => setCreating(false)}
              onOpened={async (id) => {
                await changed();
                setCreating(false);
                setSelected(id);
                setPicking(true);
              }}
            />
          ) : (
            selected && (
              <CheckDrawer
                id={selected}
                tick={tick}
                menu={menu}
                others={checks.filter((c) => c.id !== selected)}
                picking={picking}
                onPick={setPicking}
                onChanged={changed}
                onClose={() => {
                  setSelected(null);
                  setPicking(false);
                  load();
                }}
              />
            )
          )}
        </aside>
      )}
    </div>
  );
}

function CheckCard({ c, selected, onClick }: { c: CheckView; selected: boolean; onClick: () => void }) {
  const { t } = useSession();
  const tone = ageTone(c.minutesOpen);
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full flex-col items-start gap-2 rounded p-2.5 text-left @[200px]:flex-row @[200px]:items-center @[200px]:gap-3 ${selected ? 'bg-contour-wash ring-2 ring-contour-deep ring-inset' : 'bg-paper shadow-[var(--shadow-card)]'}`}
    >
      <AgeRings minutes={c.minutesOpen} label={ringLabel(c.label)} size={60} ground={selected ? 'var(--color-contour-wash)' : undefined} />
      <div className="w-full min-w-0 flex-1">
        {ringLabel(c.label) !== c.label && <p className="font-semibold break-words">{c.label}</p>}
        <p className="num text-lg leading-tight font-bold">{peso(c.due)}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-ink-soft">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" /> <span className="num">{c.guests}</span>
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <UserRound className="size-3.5 shrink-0" /> {c.serverName.replace(/\s*\(.*\)/, '')}
          </span>
        </p>
        <p className={`num text-sm ${tone === 'late' ? 'font-semibold text-pin' : tone === 'warn' ? 'text-contour-deep' : 'text-ink-soft'}`}>
          {c.minutesOpen} min{tone === 'late' ? ` · ${t('late')}` : ''}
        </p>
      </div>
    </button>
  );
}

function NewCheck({ menu, busyTables, onCancel, onOpened }: { menu: Menu | null; busyTables: string[]; onCancel: () => void; onOpened: (id: string) => void }) {
  const { t, user, run } = useSession();
  const [table, setTable] = useState<string | null>(null);
  const [guests, setGuests] = useState(2);
  const areas = [...new Set(menu?.tables.map((x) => x.area))];
  return (
    <div className="flex h-full flex-col">
      <DrawerHead title={t('New check')} onClose={onCancel} />
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {areas.map((area) => (
          <div key={area}>
            <p className="map-label mb-2 text-ink-soft">{area}</p>
            <div className="grid grid-cols-4 gap-1.5">
              {menu!.tables
                .filter((x) => x.area === area)
                .map((x) => {
                  const busy = busyTables.includes(x.id);
                  return (
                    <button
                      key={x.id}
                      disabled={busy}
                      aria-pressed={table === x.id}
                      onClick={() => {
                        setTable(x.id);
                        setGuests(Math.min(x.seats, guests));
                      }}
                      className={`btn min-h-14 flex-col gap-0 px-1 ${table === x.id ? 'btn-on' : 'btn-secondary'}`}
                    >
                      <span className="display text-lg leading-none">{x.name}</span>
                      <span className="text-xs opacity-75">{busy ? 'busy' : `${x.seats} seats`}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
        <button aria-pressed={table === null} onClick={() => setTable(null)} className={`btn w-full ${table === null ? 'btn-on' : 'btn-secondary'}`}>
          {t('Take out')}
        </button>
        <div className="flex items-center justify-between">
          <span className="font-medium">{t('Guests')}</span>
          <Stepper value={guests} min={1} max={40} onChange={setGuests} />
        </div>
      </div>
      <div className="border-t border-line px-5 py-4">
        <button
          className="btn btn-primary min-h-14 w-full text-lg"
          onClick={async () => {
            const id = await run(() => api.sell.openCheck(user!.id, { tableId: table, guests }));
            if (id) onOpened(id);
          }}
        >
          {t('Open check')}
        </button>
      </div>
    </div>
  );
}

function DrawerHead({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between border-b border-line px-5 py-4">
      <div>
        <h2 className="display text-2xl">{title}</h2>
        {sub && <p className="text-sm text-ink-soft">{sub}</p>}
      </div>
      <button className="grid size-11 place-items-center rounded text-ink-soft hover:bg-film-2" aria-label="Close" onClick={onClose}>
        <X className="size-5" />
      </button>
    </div>
  );
}

type View = 'view' | 'discount' | 'pay' | 'more' | 'done';

function CheckDrawer(p: {
  id: string;
  tick: number;
  menu: Menu | null;
  others: CheckView[];
  picking: boolean;
  onPick: (b: boolean) => void;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { t, user, online, run, askPin } = useSession();
  const [data, setData] = useState<CheckData | null>(null);
  const [view, setView] = useState<View>('view');
  const [done, setDone] = useState<{ number: string; seq: number; change: number } | null>(null);
  const reload = useCallback(() => api.sell.check(p.id).then(setData).catch(() => setData(null)), [p.id]);
  useEffect(() => {
    reload();
  }, [reload, p.tick]);

  if (view === 'done' && done) return <DoneSheet {...done} onClose={p.onClose} />;
  if (!data) return null;
  const c = data.check;
  const preview = data.preview;
  const lines: UiLine[] = c.lines.map((l) => ({
    id: l.id,
    name: l.name,
    detail: [l.modifiers.map((m) => m.name).join(', '), l.note].filter(Boolean).join(' · ') || undefined,
    qtyMilli: l.qtyMilli,
    unitPrice: l.unitPrice + l.modifiers.reduce((a, m) => a + m.price, 0),
    sent: l.sent,
  }));
  const act = async (fn: () => Promise<unknown>) => {
    const r = await run(fn);
    await p.onChanged();
    await reload();
    return r;
  };
  const unsent = c.lines.some((l) => !l.sent);
  const minutes = Math.floor((Date.now() - Date.parse(c.openedAt)) / 60_000);

  if (view === 'pay') {
    return (
      <PayPanel
        due={preview.due}
        onBack={() => setView('view')}
        onPay={async (payments) => {
          const inv = await run(() => api.sell.pay(user!.id, online, c.id, payments));
          if (inv) {
            setDone({ number: inv.number, seq: inv.seq, change: payments.reduce((a, x) => a + x.amount, 0) - preview.due });
            setView('done');
            p.onChanged();
          }
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <AgeRings minutes={minutes} label={ringLabel(c.label)} size={60} />
        <div className="min-w-0 flex-1">
          <h2 className="display truncate text-xl">{c.label}</h2>
          <div className="mt-1 flex items-center gap-2 text-sm text-ink-soft">
            <Users className="size-4" />
            <Stepper value={c.guests} min={1} max={40} onChange={(g) => act(() => api.sell.setGuests(user!.id, c.id, g))} />
          </div>
        </div>
        <button className="grid size-11 place-items-center rounded text-ink-soft hover:bg-film-2" aria-label="Close" onClick={p.onClose}>
          <X className="size-5" />
        </button>
      </div>

      {view === 'discount' ? (
        <div className="flex-1 overflow-y-auto">
          <DiscountForm
            lines={lines}
            guests={c.guests}
            current={c.specials}
            onCancel={() => setView('view')}
            onSave={async (s) => {
              const ok = await act(() => api.sell.setSpecials(user!.id, c.id, s).then(() => true));
              if (ok) setView('view');
            }}
          />
        </div>
      ) : view === 'more' ? (
        <MoreActions check={c} others={p.others} menu={p.menu} lines={lines} onBack={() => setView('view')} onDone={async (closed) => {
          await p.onChanged();
          if (closed) p.onClose();
          else {
            await reload();
            setView('view');
          }
        }} />
      ) : (
        <>
          <div className="flex-1 overflow-y-auto">
            <LineList
              lines={lines}
              onQty={async (l, q) => {
                const line = c.lines.find((x) => x.id === l.id)!;
                const pin = line.sent && q < line.qtyMilli ? await askPin(`Take back ${line.name}`) : undefined;
                if (pin === null) return;
                act(() => api.sell.setQty(user!.id, c.id, l.id, q, pin));
              }}
            />
            {c.specials.length > 0 && (
              <ul className="space-y-1 px-5 pb-2">
                {c.specials.map((s, i) => (
                  <li key={i} className="rounded border border-line bg-film-2 px-3 py-1.5 text-sm">
                    <b>{s.type}</b> {s.holder.name} · {s.diners ? `1/${s.diners} share` : 'own items'}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-line">
            <TotalsBlock totals={preview.totals} specials={preview.specialDiscounts} />
            <div className="grid grid-cols-4 gap-1.5 px-5 pb-2">
              <ActionBtn icon={Plus} label={t('Add items')} active={p.picking} onClick={() => p.onPick(!p.picking)} />
              <ActionBtn icon={ChefHat} label={t('Send to kitchen')} disabled={!unsent} onClick={() => act(() => api.sell.sendToKitchen(user!.id, c.id))} />
              <ActionBtn icon={ConciergeBell} label={t('Mark served')} disabled={c.stage === 'served' || !c.lines.length} onClick={() => act(() => api.sell.setStage(user!.id, c.id, 'served'))} />
              <ActionBtn icon={Receipt} label={t('Print bill')} disabled={!c.lines.length} onClick={() => act(() => api.sell.printBill(user!.id, online, c.id))} />
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-1.5 px-5 pb-4">
              <button className="btn btn-secondary px-3 whitespace-nowrap" onClick={() => setView('discount')}>
                {t('Senior / PWD')}
              </button>
              <button className="btn btn-primary min-h-14 text-lg" disabled={!c.lines.length} onClick={() => setView('pay')}>
                {t('Pay')} <span className="num">{peso(preview.due)}</span>
              </button>
              <button className="btn btn-secondary px-3" aria-label="More actions" onClick={() => setView('more')}>
                <Ellipsis className="size-5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ActionBtn({ icon: Icon, label, onClick, disabled, active }: { icon: typeof Plus; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button className={`btn min-h-16 flex-col gap-1 px-1 text-xs leading-tight ${active ? 'btn-on' : 'btn-secondary'}`} disabled={disabled} onClick={onClick}>
      <Icon className="size-5" strokeWidth={1.75} />
      {label}
    </button>
  );
}

function MoreActions({ check, others, menu, lines, onBack, onDone }: {
  check: CheckData['check']; others: CheckView[]; menu: Menu | null; lines: UiLine[]; onBack: () => void; onDone: (closed: boolean) => void;
}) {
  const { t, user, run, askPin } = useSession();
  const [sub, setSub] = useState<'menu' | 'move' | 'merge' | 'split' | 'cancel' | 'buyer'>('menu');
  const [reason, setReason] = useState('');
  const [split, setSplit] = useState<Record<string, number>>({});
  const [buyer, setBuyer] = useState(check.buyer ?? {});
  const busy = new Set(others.map((o) => o.tableId));
  const finish = async (fn: () => Promise<unknown>, closed = false) => {
    if ((await run(async () => (await fn(), true))) !== undefined) onDone(closed);
  };
  const back = sub === 'menu' ? onBack : () => setSub('menu');

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
      {sub === 'menu' && (
        <div className="grid gap-2">
          {(['move', 'merge', 'split', 'buyer', 'cancel'] as const).map((k) => (
            <button key={k} className={`btn justify-start ${k === 'cancel' ? 'btn-secondary text-pin' : 'btn-secondary'}`} onClick={() => setSub(k)}>
              {t({ move: 'Move table', merge: 'Merge checks', split: 'Split check', buyer: 'Buyer', cancel: 'Cancel check' }[k])}
            </button>
          ))}
        </div>
      )}
      {sub === 'move' && (
        <div className="grid grid-cols-4 gap-1.5">
          {menu?.tables.map((x) => (
            <button key={x.id} className="btn btn-secondary min-h-14" disabled={busy.has(x.id) || x.id === check.tableId} onClick={() => finish(() => api.sell.moveTable(user!.id, check.id, x.id))}>
              {x.name}
            </button>
          ))}
        </div>
      )}
      {sub === 'merge' && (
        <div className="grid gap-1.5">
          {others.length ? others.map((o) => (
            <button key={o.id} className="btn btn-secondary justify-between" onClick={() => finish(() => api.sell.merge(user!.id, check.id, o.id))}>
              <span>{o.label}</span>
              <span className="num">{peso(o.due)}</span>
            </button>
          )) : <p className="text-sm text-ink-soft">No other open checks.</p>}
        </div>
      )}
      {sub === 'split' && (
        <>
          <p className="text-sm text-ink-soft">Choose what moves to a new check for separate payment.</p>
          <ul className="divide-y divide-line rounded border border-line">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                <span className="truncate">{l.name}</span>
                <Stepper value={(split[l.id] ?? 0) / 1000} max={l.qtyMilli / 1000} onChange={(v) => setSplit({ ...split, [l.id]: v * 1000 })} />
              </li>
            ))}
          </ul>
          <button
            className="btn btn-primary w-full"
            disabled={!Object.values(split).some((v) => v > 0)}
            onClick={() => finish(() => api.sell.split(user!.id, check.id, Object.entries(split).filter(([, v]) => v > 0).map(([lineId, qtyMilli]) => ({ lineId, qtyMilli }))))}
          >
            {t('Split check')}
          </button>
        </>
      )}
      {sub === 'buyer' && (
        <>
          <p className="text-sm text-ink-soft">For a VAT-registered buyer the invoice must show name, address and TIN.</p>
          {(['name', 'address', 'tin', 'businessStyle'] as const).map((k) => (
            <label key={k} className="block text-sm font-medium">
              {{ name: 'Registered name', address: 'Address', tin: 'TIN', businessStyle: 'Business style' }[k]}
              <input className="field mt-1" value={(buyer as Record<string, string>)[k] ?? ''} onChange={(e) => setBuyer({ ...buyer, [k]: e.target.value })} />
            </label>
          ))}
          <label className="flex items-center gap-3 text-sm font-medium">
            <input type="checkbox" className="size-5 accent-[var(--color-contour-deep)]" checked={!!buyer.vatRegistered} onChange={(e) => setBuyer({ ...buyer, vatRegistered: e.target.checked })} />
            VAT-registered buyer
          </label>
          <button className="btn btn-primary w-full" onClick={() => finish(() => api.sell.setBuyer(user!.id, check.id, buyer))}>
            Save buyer
          </button>
        </>
      )}
      {sub === 'cancel' && (
        <>
          <label className="block text-sm font-medium">
            {t('Reason')}
            <input className="field mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            className="btn btn-danger w-full"
            disabled={!reason.trim()}
            onClick={async () => {
              const pin = check.lines.some((l) => l.sent) ? await askPin(`Cancel ${check.label}`) : undefined;
              if (pin === null) return;
              finish(() => api.sell.cancelCheck(user!.id, check.id, reason, pin), true);
            }}
          >
            {t('Cancel check')}
          </button>
        </>
      )}
      <button className="btn btn-quiet w-full" onClick={back}>
        {t('Back')}
      </button>
    </div>
  );
}
