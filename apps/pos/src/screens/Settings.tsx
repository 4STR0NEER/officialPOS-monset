import { useEffect, useState } from 'react';
import type { Role, Staff } from '@monset/sell';
import { api } from '../lib/api.ts';
import { parsePeso, peso } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';

type Menu = Awaited<ReturnType<typeof api.sell.menu>>;
const SECTIONS = ['Business', 'Terminal', 'Staff', 'Menu', 'Software'] as const;

export function Settings({ update }: { update: { ready: boolean; install: () => void } }) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('Business');
  return (
    <div className="flex h-full flex-1 overflow-hidden">
      <nav className="w-56 shrink-0 border-r border-line bg-paper py-4" aria-label="Settings">
        {SECTIONS.map((s) => (
          <button key={s} aria-current={section === s ? 'page' : undefined} onClick={() => setSection(s)} className={`block w-full px-5 py-3 text-left font-medium ${section === s ? 'bg-contour-wash text-ink' : 'text-ink-soft hover:bg-film-2'}`}>
            {s}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-2xl">
          {section === 'Business' && <Business />}
          {section === 'Terminal' && <Terminal />}
          {section === 'Staff' && <StaffSection />}
          {section === 'Menu' && <MenuSection />}
          {section === 'Software' && <Software update={update} />}
        </div>
      </div>
    </div>
  );
}

function OwnerOnly({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  return user?.role === 'owner' ? <>{children}</> : <p className="rounded bg-film-2 px-4 py-3 text-ink-soft">Only the owner can change this.</p>;
}

function Business() {
  const { status, user, run, refreshStatus, toast } = useSession();
  const s = status?.seller;
  const [f, setF] = useState({ registeredName: s?.registeredName ?? '', businessName: s?.businessName ?? '', address: s?.address ?? '', tin: s?.tin ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Business</h1>
      <p className="text-ink-soft">Printed at the top of every invoice. A change only affects documents issued after it, and is logged.</p>
      <OwnerOnly>
        <label className="block text-sm font-medium">Registered name<input className="field mt-1" value={f.registeredName} onChange={set('registeredName')} /></label>
        <label className="block text-sm font-medium">Business name or style<input className="field mt-1" value={f.businessName} onChange={set('businessName')} /></label>
        <label className="block text-sm font-medium">Address<input className="field mt-1" value={f.address} onChange={set('address')} /></label>
        <label className="block text-sm font-medium">TIN with branch code<input className="field num mt-1" value={f.tin} onChange={set('tin')} /></label>
        <button className="btn btn-primary" onClick={async () => {
          if (await run(() => api.core.configureSeller(user!.id, { ...f, businessName: f.businessName || undefined }).then(() => true))) {
            refreshStatus();
            toast('Business details saved', 'ok');
          }
        }}>Save</button>
      </OwnerOnly>
      <div className="rounded bg-film-2 px-4 py-3 text-sm text-ink-soft">
        <p className="map-label mb-1">Accredited supplier (footer)</p>
        {status?.supplier && Object.entries(status.supplier).map(([k, v]) => <p key={k}>{k}: {String(v)}</p>)}
      </div>
    </div>
  );
}

function Terminal() {
  const { status, user, run, refreshStatus, toast } = useSession();
  const tm = status?.terminal;
  const [f, setF] = useState({ min: tm?.min ?? '', serial: tm?.serial ?? '', sln: tm?.sln ?? '', ptuLabel: tm?.ptu_label ?? 'PTU No.', ptuNo: tm?.ptu_no ?? '', ptuDate: tm?.ptu_date ?? '', paper: tm?.paper ?? '80' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Terminal</h1>
      <p className="text-ink-soft">
        {tm?.terminal_id} · {tm?.mode} · {tm?.vat_mode}. Enter the BIR registration numbers once they are issued. The install mode can never change.
      </p>
      <OwnerOnly>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium">Machine ID no. (MIN)<input className="field num mt-1" value={f.min} onChange={set('min')} /></label>
          <label className="text-sm font-medium">Serial no.<input className="field mt-1" value={f.serial} onChange={set('serial')} /></label>
          <label className="text-sm font-medium">Software license no.<input className="field mt-1" value={f.sln} onChange={set('sln')} /></label>
          <label className="text-sm font-medium">Paper
            <select className="field mt-1" value={f.paper} onChange={set('paper')}><option value="58">58 mm</option><option value="80">80 mm</option><option value="A4">A4</option></select>
          </label>
          <label className="text-sm font-medium">Permit label
            <select className="field mt-1" value={f.ptuLabel} onChange={set('ptuLabel')}><option>PTU No.</option><option>AC No.</option></select>
          </label>
          <label className="text-sm font-medium">Permit no.<input className="field mt-1" value={f.ptuNo} onChange={set('ptuNo')} /></label>
          <label className="text-sm font-medium">Permit date<input type="date" className="field mt-1" value={f.ptuDate} onChange={set('ptuDate')} /></label>
        </div>
        <button className="btn btn-primary" onClick={async () => {
          const patch = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || undefined]));
          if (await run(() => api.core.updateTerminal(user!.id, patch as never).then(() => true))) {
            refreshStatus();
            toast('Terminal details saved', 'ok');
          }
        }}>Save</button>
      </OwnerOnly>
    </div>
  );
}

function StaffSection() {
  const { user, run, toast } = useSession();
  const [list, setList] = useState<Staff[]>([]);
  const [f, setF] = useState({ name: '', role: 'cashier' as Role, pin: '' });
  const load = () => api.sell.listStaff().then(setList);
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Staff</h1>
      <ul className="divide-y divide-line rounded border border-line bg-paper">
        {list.map((s) => (
          <li key={s.id} className="flex justify-between px-4 py-3"><span className="font-medium">{s.name}</span><span className="text-ink-soft">{s.role}</span></li>
        ))}
      </ul>
      <OwnerOnly>
        <div className="grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-2">
          <label className="text-sm font-medium">Name<input className="field mt-1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="text-sm font-medium">Role
            <select className="field mt-1" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}><option value="cashier">Cashier</option><option value="supervisor">Supervisor</option><option value="owner">Owner</option></select>
          </label>
          <label className="text-sm font-medium">PIN<input className="field num mt-1" type="password" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} /></label>
          <button className="btn btn-primary" onClick={async () => {
            if (await run(() => api.sell.addStaff(user!.id, f))) {
              setF({ name: '', role: 'cashier', pin: '' });
              toast('Staff added', 'ok');
              load();
            }
          }}>Add</button>
        </div>
      </OwnerOnly>
    </div>
  );
}

function MenuSection() {
  const { user, run, toast } = useSession();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const load = () => api.sell.menu().then(setMenu);
  useEffect(() => {
    load();
  }, []);
  const canEdit = user?.role !== 'cashier';
  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Menu</h1>
      <p className="text-ink-soft">Price changes apply to new orders only; issued invoices keep the price they were sold at.</p>
      {menu?.categories.map((c) => (
        <div key={c.id}>
          <p className="map-label mb-1 text-ink-soft">{c.name}</p>
          <ul className="divide-y divide-line rounded border border-line bg-paper">
            {menu.items.filter((i) => i.categoryId === c.id).map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2">
                <span className="flex-1 font-medium">{i.name}</span>
                <span className="text-xs text-ink-soft">{i.vatClass}{i.discountCategory ? ` · ${i.discountCategory}` : ''}</span>
                {canEdit ? (
                  <input
                    className="field num min-h-10 w-28 text-right"
                    inputMode="decimal"
                    value={edit[i.id] ?? peso(i.price)}
                    onChange={(e) => setEdit({ ...edit, [i.id]: e.target.value })}
                    onBlur={async () => {
                      const v = edit[i.id] == null ? null : parsePeso(edit[i.id]);
                      if (v == null || v === i.price) return;
                      if (await run(() => api.sell.saveItem(user!.id, { ...i, price: v }))) {
                        toast(`${i.name} now ${peso(v)}`, 'ok');
                        load();
                      }
                    }}
                  />
                ) : (
                  <span className="num w-28 text-right">{peso(i.price)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Software({ update }: { update: { ready: boolean; install: () => void } }) {
  const { status, user, run, askPin } = useSession();
  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Software</h1>
      <dl className="grid grid-cols-[12rem_1fr] gap-y-2 rounded bg-paper px-5 py-4 shadow-[var(--shadow-card)]">
        <dt className="text-ink-soft">Compliance core</dt><dd className="num font-semibold">v{status?.coreVersion}</dd>
        <dt className="text-ink-soft">Storage</dt><dd>{status?.persistent ? 'Saved on this device (private browser storage)' : 'NOT SAVED: memory only'}</dd>
        <dt className="text-ink-soft">Integrity</dt><dd>{status?.locked ? 'Locked: a supervisor must review' : 'Verified'}</dd>
      </dl>
      <div className="rounded border border-line bg-paper px-5 py-4">
        <p className="font-semibold">Updates</p>
        <p className="mt-1 text-sm text-ink-soft">
          New versions never install by themselves. When one is ready, a supervisor installs it here, after the day's Z reading.
        </p>
        <button
          className="btn btn-primary mt-3"
          disabled={!update.ready}
          onClick={async () => {
            const today = await api.core.peekReading();
            if (today.toSeq >= today.fromSeq) return void run(() => Promise.reject(new Error('Run the Z reading first: there are documents since the last one.')));
            const pin = await askPin('Install the software update');
            if (pin && (await run(() => api.sell.approve(pin, 'software update')))) {
              await api.core.record(user!.id, 'SOFTWARE_UPDATE', 'pos', { core: status?.coreVersion }, null);
              update.install();
            }
          }}
        >
          {update.ready ? 'Install update' : 'No update waiting'}
        </button>
      </div>
    </div>
  );
}
