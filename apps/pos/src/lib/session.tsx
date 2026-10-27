import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Delete } from 'lucide-react';
import type { Staff } from '@monset/sell';
import { api, PosError } from './api.ts';
import { translate, type Lang } from './i18n.ts';

export type Status = Awaited<ReturnType<typeof api.app.status>>;

interface Session {
  status: Status | null;
  refreshStatus: () => Promise<void>;
  user: Staff | null;
  setUser: (u: Staff | null) => void;
  /** Whether the hub could be reached. Standalone terminals have no hub and are always "online". */
  online: boolean;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (s: string) => string;
  toast: (message: string, tone?: 'error' | 'ok') => void;
  clearToasts: () => void;
  /** Ask a supervisor for their PIN. Resolves with the PIN, or null if cancelled. */
  askPin: (why: string) => Promise<string | null>;
  /** Run an action; show its error as a toast instead of throwing. Returns undefined on failure. */
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => useContext(Ctx)!;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [user, setUser] = useState<Staff | null>(null);
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return (localStorage.getItem('mpos.lang') as Lang) || 'en';
    } catch {
      return 'en';
    }
  });
  const [toasts, setToasts] = useState<{ id: number; message: string; tone: 'error' | 'ok' }[]>([]);
  const [pinAsk, setPinAsk] = useState<{ why: string; resolve: (p: string | null) => void } | null>(null);
  const toastId = useRef(0);

  const refreshStatus = useCallback(async () => setStatus(await api.app.status()), []);
  useEffect(() => {
    refreshStatus();
    navigator.storage?.persist?.(); // ask the browser never to evict the ledger (OPEN_QUESTIONS Q3a)
  }, [refreshStatus]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('mpos.lang', l);
    } catch {
      /* per-viewer convenience only */
    }
  };
  const toast = useCallback((message: string, tone: 'error' | 'ok' = 'error') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3000);
  }, []);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch (e) {
        toast(e instanceof PosError ? e.message : String(e));
        return undefined;
      }
    },
    [toast],
  );
  const askPin = useCallback((why: string) => new Promise<string | null>((resolve) => setPinAsk({ why, resolve })), []);

  const value = useMemo<Session>(
    () => ({ status, refreshStatus, user, setUser, online: true, lang, setLang, t: (s) => translate(lang, s), toast, clearToasts: () => setToasts([]), askPin, run }),
    [status, refreshStatus, user, lang, toast, askPin, run],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-[92px] z-50 flex w-[24rem] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`slide-in pointer-events-auto rounded px-4 py-3 text-sm font-medium shadow-[var(--shadow-card)] ${t.tone === 'error' ? 'bg-pin text-white' : 'bg-night text-film'}`}
          >
            {t.message}
          </div>
        ))}
      </div>
      {pinAsk && (
        <PinDialog
          why={pinAsk.why}
          t={value.t}
          onDone={(p) => {
            pinAsk.resolve(p);
            setPinAsk(null);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

function PinDialog({ why, t, onDone }: { why: string; t: (s: string) => string; onDone: (pin: string | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pin, setPin] = useState('');
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog
      ref={ref}
      onCancel={() => onDone(null)}
      className="m-auto w-[360px] rounded bg-paper p-6 text-ink shadow-[var(--shadow-drawer)] backdrop:bg-night/60"
    >
      <p className="text-lg font-semibold">{why}</p>
      <p className="mt-1 mb-4 text-sm text-ink-soft">{t('Supervisor PIN')} needed.</p>
      <PinPad value={pin} onChange={setPin} onEnter={() => pin && onDone(pin)} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="btn btn-secondary" onClick={() => onDone(null)}>
          {t('Cancel')}
        </button>
        <button className="btn btn-primary" disabled={pin.length < 4} onClick={() => onDone(pin)}>
          {t('Approve')}
        </button>
      </div>
    </dialog>
  );
}

/** Big-key PIN pad. Also accepts the keyboard on a PC. No animation: it is pressed hundreds of times a day. */
export function PinPad({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key) && value.length < 6) onChange(value + e.key);
      else if (e.key === 'Backspace') onChange(value.slice(0, -1));
      else if (e.key === 'Enter') onEnter();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [value, onChange, onEnter]);
  return (
    <div>
      <div className="mb-3 flex h-12 items-center justify-center gap-3" aria-label={`${value.length} digits entered`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`size-3.5 rounded-full ${i < value.length ? 'bg-night' : 'border-2 border-line'}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map((k) => (
          <button
            key={k}
            type="button"
            className={`num h-16 rounded text-2xl font-semibold active:bg-well ${k.length > 1 ? 'text-base text-ink-soft' : 'bg-film-2'}`}
            onClick={() => (k === 'clear' ? onChange('') : k === 'back' ? onChange(value.slice(0, -1)) : value.length < 6 && onChange(value + k))}
          >
            {k === 'clear' ? 'Clear' : k === 'back' ? <Delete className="mx-auto size-6" aria-label="Delete" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}
