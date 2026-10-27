import { useEffect, useState } from 'react';
import type { SaleLine, SpecialDiscountInput } from '@monset/core';
import type { Item, Modifier } from '@monset/sell';
import { api } from '../lib/api.ts';
import { peso } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';
import { MenuPicker } from '../components/MenuPicker.tsx';
import { DiscountForm, DoneSheet, LineList, PayPanel, TotalsBlock, type UiLine } from '../components/order.tsx';

type Menu = Awaited<ReturnType<typeof api.sell.menu>>;
type Preview = Awaited<ReturnType<typeof api.sell.previewLines>>;
interface CartLine { id: string; item: Item; modifiers: Modifier[]; qtyMilli: number }

const toSale = (cart: CartLine[]): SaleLine[] =>
  cart.map((c) => ({
    description: c.modifiers.length ? `${c.item.name} (${c.modifiers.map((m) => m.name).join(', ')})` : c.item.name,
    qtyMilli: c.qtyMilli,
    unitPrice: c.item.price + c.modifiers.reduce((a, m) => a + m.price, 0),
    vatClass: c.item.vatClass,
    category: c.item.discountCategory ?? undefined,
  }));

/** Retail and counter takeout: scan or tap, pay, done. No check, no table. */
export function QuickSale() {
  const { t, user, online, run, toast } = useSession();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [specials, setSpecials] = useState<SpecialDiscountInput[]>([]);
  const [preview, setPreview] = useState<Preview>(null);
  const [view, setView] = useState<'cart' | 'discount' | 'pay' | 'done'>('cart');
  const [done, setDone] = useState<{ number: string; seq: number; change: number } | null>(null);

  useEffect(() => {
    api.sell.menu().then(setMenu);
  }, []);
  useEffect(() => {
    api.sell
      .previewLines(toSale(cart), specials)
      .then(setPreview)
      .catch((e) => {
        toast(e.message);
        setSpecials([]); // the cart changed under a discount that no longer fits; ask again
      });
  }, [cart, specials, toast]);

  const add = (item: Item, modifiers: Modifier[]) =>
    setCart((c) => {
      const same = c.find((l) => l.item.id === item.id && JSON.stringify(l.modifiers) === JSON.stringify(modifiers));
      return same ? c.map((l) => (l === same ? { ...l, qtyMilli: l.qtyMilli + 1000 } : l)) : [...c, { id: crypto.randomUUID(), item, modifiers, qtyMilli: 1000 }];
    });
  const lines: UiLine[] = cart.map((c) => ({
    id: c.id,
    name: c.item.name,
    detail: c.modifiers.map((m) => m.name).join(', ') || undefined,
    qtyMilli: c.qtyMilli,
    unitPrice: c.item.price + c.modifiers.reduce((a, m) => a + m.price, 0),
  }));
  const due = preview?.totals.net ?? 0;
  const reset = () => {
    setCart([]);
    setSpecials([]);
    setDone(null);
    setView('cart');
  };

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="min-w-0 flex-1">
        {menu && (
          <MenuPicker
            categories={menu.categories}
            items={menu.items}
            onPick={add}
            onBarcode={async (code) => {
              const it = await api.sell.itemByBarcode(code);
              if (it) add(it, []);
              else toast(`No item has barcode ${code}`);
            }}
          />
        )}
      </div>
      <aside className="flex w-[clamp(352px,34vw,420px)] shrink-0 flex-col border-l border-line bg-paper" aria-label={t('Cart')}>
        {view === 'done' && done ? (
          <DoneSheet {...done} onClose={reset} />
        ) : view === 'pay' ? (
          <PayPanel
            due={due}
            onBack={() => setView('cart')}
            onPay={async (payments) => {
              const inv = await run(() => api.sell.quickSale(user!.id, online, toSale(cart), payments, specials));
              if (inv) {
                setDone({ number: inv.number, seq: inv.seq, change: payments.reduce((a, p) => a + p.amount, 0) - due });
                setView('done');
              }
            }}
          />
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="display text-2xl">{t('Quick sale')}</h2>
              {cart.length > 0 && (
                <button className="btn btn-quiet min-h-10" onClick={reset}>
                  {t('Clear')}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {view === 'discount' ? (
                <DiscountForm lines={lines} guests={1} current={specials} onCancel={() => setView('cart')} onSave={(s) => { setSpecials(s); setView('cart'); }} />
              ) : (
                <LineList lines={lines} onQty={(l, q) => setCart((c) => (q === 0 ? c.filter((x) => x.id !== l.id) : c.map((x) => (x.id === l.id ? { ...x, qtyMilli: q } : x))))} />
              )}
            </div>
            {view === 'cart' && (
              <div className="border-t border-line">
                <TotalsBlock totals={preview?.totals ?? null} specials={preview?.specialDiscounts} />
                <div className="grid grid-cols-[auto_1fr] gap-1.5 px-5 pb-4">
                  <button className="btn btn-secondary" disabled={!cart.length} onClick={() => setView('discount')}>
                    {t('Senior / PWD')}
                  </button>
                  <button className="btn btn-primary min-h-14 text-lg" disabled={!cart.length} onClick={() => setView('pay')}>
                    {t('Pay')} <span className="num">{peso(due)}</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
