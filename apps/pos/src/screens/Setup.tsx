import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { MonsetMark } from '../components/Rail.tsx';

/** First run on a new device: live or demo install, the seller's registered details, the owner's PIN. */
export function Setup() {
  const { refreshStatus, run } = useSession();
  const [demo, setDemo] = useState(true);
  const [f, setF] = useState({ registeredName: '', businessName: '', address: '', tin: '', terminalId: 'T1', vatMode: 'VAT', owner: '', pin: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ok = f.registeredName && f.address && /^\d{3}-?\d{3}-?\d{3}(-?\d{5})?$/.test(f.tin.trim()) && f.terminalId && (demo || (f.owner && /^\d{4,6}$/.test(f.pin)));

  return (
    <main className="flex h-full">
      <section className="flex w-[38%] flex-col justify-between bg-night p-10 text-film">
        <MonsetMark className="h-12 w-12" />
        <div>
          <h1 className="display text-4xl leading-tight">Set up this terminal</h1>
          <p className="mt-3 max-w-sm text-mist">
            Sales are stored on this device and nowhere else. Registration details from BIR (MIN, PTU) can be added later in Settings.
          </p>
        </div>
        <p className="text-sm text-mist">Monset POS · {demo ? 'demo install' : 'live install'}</p>
      </section>
      <section className="flex-1 overflow-y-auto p-10">
        <div className="max-w-xl space-y-6">
          <div>
            <p className="map-label mb-2 text-ink-soft">Install type</p>
            <div className="grid grid-cols-2 gap-2">
              <button aria-pressed={demo} onClick={() => setDemo(true)} className={`btn min-h-20 flex-col items-start gap-0.5 px-4 text-left ${demo ? 'btn-on' : 'btn-secondary'}`}>
                <span className="font-bold">Demo</span>
                <span className="text-sm font-normal opacity-80">Sample restaurant. Every document says DEMO.</span>
              </button>
              <button aria-pressed={!demo} onClick={() => setDemo(false)} className={`btn min-h-20 flex-col items-start gap-0.5 px-4 text-left ${!demo ? 'btn-on' : 'btn-secondary'}`}>
                <span className="font-bold">Live</span>
                <span className="text-sm font-normal opacity-80">Real invoices. Cannot be switched to demo later.</span>
              </button>
            </div>
          </div>
          <div className="space-y-3">
            <p className="map-label text-ink-soft">Seller, as registered with BIR</p>
            <label className="block text-sm font-medium">Registered name<input className="field mt-1" value={f.registeredName} onChange={set('registeredName')} /></label>
            <label className="block text-sm font-medium">Business name or style (optional)<input className="field mt-1" value={f.businessName} onChange={set('businessName')} /></label>
            <label className="block text-sm font-medium">Business address<input className="field mt-1" value={f.address} onChange={set('address')} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm font-medium">TIN with branch code<input className="field num mt-1" placeholder="123-456-789-00000" value={f.tin} onChange={set('tin')} /></label>
              <label className="block text-sm font-medium">VAT registration
                <select className="field mt-1" value={f.vatMode} onChange={set('vatMode')}>
                  <option value="VAT">VAT registered</option>
                  <option value="NONVAT">Non-VAT (percentage tax)</option>
                  <option value="EXEMPT">VAT-exempt</option>
                </select>
              </label>
            </div>
            <label className="block text-sm font-medium">Terminal name<input className="field mt-1" value={f.terminalId} onChange={set('terminalId')} /></label>
          </div>
          {!demo && (
            <div className="space-y-3">
              <p className="map-label text-ink-soft">Owner account</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm font-medium">Name<input className="field mt-1" value={f.owner} onChange={set('owner')} /></label>
                <label className="block text-sm font-medium">PIN (4 to 6 digits)<input className="field num mt-1" type="password" inputMode="numeric" value={f.pin} onChange={set('pin')} /></label>
              </div>
            </div>
          )}
          <button
            className="btn btn-primary min-h-14 w-full text-lg"
            disabled={!ok}
            onClick={async () => {
              const done = await run(() =>
                api.app.setup({
                  demo,
                  terminalId: f.terminalId.trim(),
                  vatMode: f.vatMode as 'VAT',
                  seller: { registeredName: f.registeredName.trim(), businessName: f.businessName.trim() || undefined, address: f.address.trim(), tin: f.tin.trim() },
                  owner: demo ? undefined : { name: f.owner.trim(), pin: f.pin },
                }).then(() => true),
              );
              if (done) refreshStatus();
            }}
          >
            Start selling
          </button>
        </div>
      </section>
    </main>
  );
}
