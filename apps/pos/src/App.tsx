import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useSession } from './lib/session.tsx';
import { Rail, type Route } from './components/Rail.tsx';
import { Board } from './screens/Board.tsx';
import { QuickSale } from './screens/QuickSale.tsx';
import { Readings } from './screens/Readings.tsx';
import { Journal } from './screens/Journal.tsx';
import { Settings } from './screens/Settings.tsx';
import { Setup } from './screens/Setup.tsx';
import { Login } from './screens/Login.tsx';

export function App() {
  const { status, user, clearToasts } = useSession();
  const [route, setRouteState] = useState<Route>('board');
  const setRoute = (r: Route) => {
    clearToasts(); // a message belongs to the screen it was about
    setRouteState(r);
  };
  const [updateReady, setUpdateReady] = useState(false);
  const updateSW = useRef<(reload?: boolean) => Promise<void>>(null);
  useEffect(() => {
    // 'prompt' mode: a new version waits; it is installed from Settings, never silently.
    updateSW.current = registerSW({ onNeedRefresh: () => setUpdateReady(true) });
  }, []);

  if (!status) return <div className="grid h-full place-items-center bg-night text-mist">Opening the ledger…</div>;
  if (!status.terminal) return <Setup />;
  if (!user) return <Login />;
  return (
    <div className="flex h-full">
      <Rail route={route} onRoute={setRoute} />
      <main className="flex min-w-0 flex-1">
        {status.locked && route !== 'settings' ? (
          <div className="m-auto max-w-md rounded bg-paper p-6 shadow-[var(--shadow-card)]">
            <h1 className="display text-2xl text-pin">Issuing is locked</h1>
            <p className="mt-2 text-ink-soft">The integrity check found records that do not match their seals. A supervisor must review the activity log before anything else is issued.</p>
          </div>
        ) : route === 'board' ? (
          <Board />
        ) : route === 'quick' ? (
          <QuickSale />
        ) : route === 'readings' ? (
          <Readings />
        ) : route === 'journal' ? (
          <Journal />
        ) : (
          <Settings update={{ ready: updateReady, install: () => updateSW.current?.(true) }} />
        )}
      </main>
    </div>
  );
}
