import { useState } from 'react';
import { api } from '../lib/api.ts';
import { PinPad, useSession } from '../lib/session.tsx';
import { MonsetMark } from '../components/Rail.tsx';

export function Login() {
  const { status, setUser, run, t } = useSession();
  const [pin, setPin] = useState('');
  const submit = async () => {
    const u = await run(() => api.sell.login(pin));
    setPin('');
    if (u) setUser(u);
  };
  const seller = status?.seller;
  return (
    <main className="grid h-full grid-cols-[1fr_440px] bg-night text-film">
      <section className="flex flex-col justify-between p-10">
        <MonsetMark className="h-12 w-12" />
        <div>
          <h1 className="display text-5xl leading-tight">{seller?.businessName ?? seller?.registeredName}</h1>
          <p className="mt-2 text-mist">
            {status?.terminal?.terminal_id} · {status?.terminal?.mode === 'DEMO' ? 'Demo install' : 'Live'} · core v{status?.coreVersion}
          </p>
          {status?.demoPins && (
            <p className="mt-6 max-w-md rounded bg-night-2 px-4 py-3 text-sm text-mist">
              Demo PINs: owner <b className="num text-film">{status.demoPins.owner}</b>, supervisor <b className="num text-film">{status.demoPins.supervisor}</b>, cashier{' '}
              <b className="num text-film">{status.demoPins.cashier}</b>
            </p>
          )}
          {!status?.persistent && (
            <p className="mt-4 max-w-md rounded bg-pin px-4 py-3 text-sm font-medium text-white">
              This browser cannot keep data. Sales made here would be lost when it closes; use Chrome or Edge, not a private window.
            </p>
          )}
        </div>
        <p className="text-sm text-mist">Monset POS</p>
      </section>
      <section className="flex flex-col justify-center bg-paper px-10 text-ink">
        <p className="map-label mb-6 text-center text-ink-soft">{t('Enter your PIN')}</p>
        <PinPad value={pin} onChange={setPin} onEnter={submit} />
        <button className="btn btn-primary mt-4 min-h-14 text-lg" disabled={pin.length < 4} onClick={submit}>
          Sign in
        </button>
      </section>
    </main>
  );
}
