import type { Sell } from './index.ts';

// Demo restaurant for DEMO installs and the BIR walkthrough. Every name and price here is
// synthetic, and the demo PINs only exist on demo installs.
export const DEMO_PINS = { owner: '9999', supervisor: '2222', cashier: '1111' } as const;

const MENU: [string, [string, number, ('VATABLE' | 'EXEMPT')?, string?, string?][]][] = [
  ['Ulam', [['Chicken adobo', 22500], ['Pork sinigang', 32000], ['Kare-kare', 68000], ['Lechon kawali', 29500], ['Sizzling sisig', 26500], ['Crispy pata', 79000], ['Bistek Tagalog', 27500], ['Ginataang gulay', 18500]]],
  ['Pulutan', [['Chicharon bulaklak', 21500], ['Kinilaw na tanigue', 34500], ['Calamares', 24500]]],
  ['Kanin', [['Plain rice', 4500], ['Garlic rice', 6000], ['Java rice', 6500]]],
  ['Merienda', [['Pancit canton', 19500], ['Lumpiang shanghai', 16500], ['Turon', 8500]]],
  ['Panghimagas', [['Halo-halo', 16000], ['Leche flan', 11000], ['Buko pandan', 9500]]],
  ['Inumin', [['Calamansi juice', 8500], ['Iced tea (pitcher)', 18000], ['Buko juice', 9500], ['Brewed coffee', 7500], ['San Miguel Pale Pilsen', 9500], ['Bottled water', 3500]]],
  ['Tindahan', [['Fresh eggs (tray)', 26000, 'EXEMPT', 'BASIC_NECESSITY', '4800016644214'], ['Infant formula 900g', 112000, 'VATABLE', 'BABY_MILK', '4800361380137'], ['Paracetamol 500mg (10s)', 4500, 'VATABLE', 'MEDICINE', '4806502530019']]],
];

const ADD_ONS: Record<string, { name: string; price: number }[]> = {
  'Sizzling sisig': [{ name: 'Extra egg', price: 2500 }, { name: 'Extra spicy', price: 0 }, { name: 'No onions', price: 0 }],
  'Halo-halo': [{ name: 'Extra leche flan', price: 3500 }, { name: 'Extra ube', price: 2500 }],
  'Plain rice': [{ name: 'Extra rice', price: 4500 }],
  'Pork sinigang': [{ name: 'Extra sour', price: 0 }, { name: 'Add gabi', price: 2000 }],
};

/** Seeds staff, menu and tables. Returns the owner's id. Only call on an empty demo install. */
export function seedDemo(sell: Sell): string {
  const owner = sell.addStaff(null, { name: 'Lola Remy (owner)', role: 'owner', pin: DEMO_PINS.owner });
  sell.addStaff(owner, { name: 'Jun (supervisor)', role: 'supervisor', pin: DEMO_PINS.supervisor });
  sell.addStaff(owner, { name: 'Bea (cashier)', role: 'cashier', pin: DEMO_PINS.cashier });
  MENU.forEach(([cat, items], ci) => {
    const categoryId = sell.saveCategory(owner, { name: cat, sort: ci });
    items.forEach(([name, price, vatClass, discountCategory, barcode], ii) =>
      sell.saveItem(owner, { categoryId, name, price, vatClass: vatClass ?? 'VATABLE', discountCategory: discountCategory ?? null, barcode: barcode ?? null, modifiers: ADD_ONS[name] ?? [], sort: ii }),
    );
  });
  for (let n = 1; n <= 12; n++) sell.saveTable(owner, { name: `T${n}`, seats: n <= 4 ? 2 : n <= 10 ? 4 : 8, area: n <= 10 ? 'Dining' : 'Function', sort: n });
  sell.saveTable(owner, { name: 'Bar 1', seats: 2, area: 'Bar', sort: 20 });
  return owner;
}
