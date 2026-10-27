import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { Category, Item, Modifier } from '@monset/sell';
import { peso } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';

/**
 * Category tabs, a search box that doubles as the barcode field (a USB or Bluetooth scanner types
 * the code and presses Enter), and big item tiles. A tap adds one, instantly, with no animation.
 */
export function MenuPicker({
  categories,
  items,
  onPick,
  onBarcode,
  onClose,
}: {
  categories: Category[];
  items: Item[];
  onPick: (item: Item, modifiers: Modifier[]) => void;
  onBarcode: (code: string) => void;
  onClose?: () => void;
}) {
  const { t } = useSession();
  const [cat, setCat] = useState(categories[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<{ item: Item; chosen: Modifier[] } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!cat && categories[0]) setCat(categories[0].id);
  }, [categories, cat]);
  // Scanners type fast and end with Enter; keep the field focused on a PC so scans always land.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && /^[\w-]$/.test(e.key)) search.current?.focus();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => i.name.toLowerCase().includes(s) || i.barcode === s) : items.filter((i) => i.categoryId === cat);
  }, [items, cat, q]);

  return (
    <section className="flex h-full min-w-0 flex-col" aria-label="Menu">
      <div className="flex items-center gap-2 border-b border-line bg-film-2 px-4 py-3">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-soft" />
          <input
            ref={search}
            className="field pl-10"
            placeholder={t('Scan or search items')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q.trim()) {
                if (/^\d{6,14}$/.test(q.trim())) onBarcode(q.trim());
                else if (shown.length === 1) onPick(shown[0], []);
                setQ('');
              }
            }}
            aria-label={t('Search')}
          />
        </label>
        {onClose && (
          <button className="btn btn-night" onClick={onClose}>
            {t('Done')}
          </button>
        )}
      </div>
      {!q && (
        <div className="flex gap-1 overflow-x-auto border-b border-line px-4 pt-2" role="tablist">
          {categories.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={cat === c.id}
              onClick={() => setCat(c.id)}
              className={`min-h-12 shrink-0 border-b-2 px-4 font-semibold ${cat === c.id ? 'border-contour text-ink' : 'border-transparent text-ink-soft'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      {options && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-contour-wash px-4 py-3">
          <span className="mr-1 font-semibold">{options.item.name}</span>
          {options.item.modifiers.map((m) => {
            const on = options.chosen.some((x) => x.name === m.name);
            return (
              <button
                key={m.name}
                aria-pressed={on}
                className={`btn min-h-10 px-3 text-sm ${on ? 'btn-on' : 'btn-secondary'}`}
                onClick={() => setOptions({ ...options, chosen: on ? options.chosen.filter((x) => x.name !== m.name) : [...options.chosen, m] })}
              >
                {m.name}
                {m.price > 0 && <span className="num opacity-80">+{peso(m.price)}</span>}
              </button>
            );
          })}
          <span className="ml-auto flex gap-2">
            <button className="grid size-10 place-items-center text-ink-soft" aria-label={t('Cancel')} onClick={() => setOptions(null)}>
              <X className="size-5" />
            </button>
            <button
              className="btn btn-primary min-h-10"
              onClick={() => {
                onPick(options.item, options.chosen);
                setOptions(null);
              }}
            >
              Add
            </button>
          </span>
        </div>
      )}
      <div className="grid flex-1 auto-rows-[104px] grid-cols-[repeat(auto-fill,minmax(148px,1fr))] content-start gap-2 overflow-y-auto p-4">
        {shown.map((i) => (
          <div key={i.id} className="relative">
            <button
              className="flex h-full w-full flex-col justify-between rounded border border-line bg-paper p-3 text-left shadow-[var(--shadow-card)] active:bg-film-2"
              onClick={() => onPick(i, [])}
            >
              <span className="line-clamp-2 leading-snug font-semibold">{i.name}</span>
              <span className="num text-ink-soft">{peso(i.price)}</span>
            </button>
            {i.modifiers.length > 0 && (
              <button
                className="absolute right-1.5 bottom-1.5 grid size-10 place-items-center rounded text-ink-soft hover:bg-film-2"
                aria-label={`${i.name} options`}
                onClick={() => setOptions({ item: i, chosen: [] })}
              >
                <SlidersHorizontal className="size-4" />
              </button>
            )}
          </div>
        ))}
        {!shown.length && <p className="col-span-full py-10 text-center text-ink-soft">No items match “{q}”.</p>}
      </div>
    </section>
  );
}
