import { BookOpen, LayoutGrid, ReceiptText, ScanBarcode, Settings, Wifi } from 'lucide-react';
import { useSession } from '../lib/session.tsx';

export type Route = 'board' | 'quick' | 'readings' | 'journal' | 'settings';

const NAV: { id: Route; label: string; Icon: typeof LayoutGrid }[] = [
  { id: 'board', label: 'Board', Icon: LayoutGrid },
  { id: 'quick', label: 'Quick sale', Icon: ScanBarcode },
  { id: 'readings', label: 'Readings', Icon: ReceiptText },
  { id: 'journal', label: 'Journal', Icon: BookOpen },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

export function MonsetMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="80 95 945 875" className={className} aria-hidden="true">
      <path d="M298 380 637 955M587 107l426 853" stroke="rgba(233,238,245,.42)" strokeWidth="14" fill="none" />
      <polygon fill="#e9eef5" points="301,390 362,505 159,948 90,830" />
      <polygon fill="#6f98c4" points="565,122 625,230 432,627 368,505" />
    </svg>
  );
}

export function Rail({ route, onRoute }: { route: Route; onRoute: (r: Route) => void }) {
  const { t, user, setUser, lang, setLang, online, status } = useSession();
  const initials = user?.name.replace(/\(.*\)/, '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <nav className="flex w-[76px] shrink-0 flex-col items-stretch bg-night py-3 text-film" aria-label="Main">
      <div className="mb-4 flex justify-center">
        <MonsetMark className="h-8 w-8" />
      </div>
      <ul className="flex flex-col gap-1 px-1.5">
        {NAV.map(({ id, label, Icon }) => {
          const on = route === id;
          return (
            <li key={id}>
              <button
                onClick={() => onRoute(id)}
                aria-current={on ? 'page' : undefined}
                className={`flex w-full flex-col items-center gap-1 rounded px-1 py-2.5 text-[0.7rem] leading-tight font-medium ${on ? 'bg-night-3 text-film' : 'text-mist hover:bg-night-2'}`}
              >
                <Icon className={`size-6 ${on ? 'text-contour' : ''}`} strokeWidth={1.75} />
                <span className="text-center">{t(label)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto flex flex-col items-center gap-2 px-1.5">
        <div className="flex flex-col items-center gap-1 text-[0.65rem] text-mist" title={status?.persistent ? 'Ledger saved on this device' : 'Not saved: this browser has no private storage'}>
          <Wifi className={`size-5 ${online ? 'text-mist' : 'text-pin'}`} strokeWidth={1.75} />
          {online ? t('Standalone') : t('Offline')}
        </div>
        <button className="btn btn-quiet min-h-9 w-full px-0 text-xs text-mist hover:!bg-night-2" onClick={() => setLang(lang === 'en' ? 'fil' : 'en')} aria-label={t('Language')}>
          {lang === 'en' ? 'EN' : 'FIL'}
        </button>
        <button
          className="grid size-12 place-items-center rounded-full bg-night-3 text-sm font-bold"
          title={`${user?.name}: ${t('Sign out')}`}
          aria-label={t('Sign out')}
          onClick={() => setUser(null)}
        >
          {initials}
        </button>
      </div>
    </nav>
  );
}
