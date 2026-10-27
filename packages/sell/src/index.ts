import { CoreError, priceSale, sha256hex, type Buyer, type Core, type Db, type DiscountRule, type Payment, type SaleLine, type SpecialDiscountInput, type VatClass } from '@monset/core';

// Business module: menu, tables, staff and open checks for restaurant and retail selling.
// Outside the compliance core. It only reaches the ledger through the core's public API
// (postSale, issueSupplementary, record), and its own tables are ordinary, editable rows.

export type Role = 'cashier' | 'supervisor' | 'owner';
export type Stage = 'seated' | 'ordered' | 'served' | 'billout';
export const STAGES: Stage[] = ['seated', 'ordered', 'served', 'billout'];

export interface Staff { id: string; name: string; role: Role }
export interface Category { id: string; name: string; sort: number }
export interface Modifier { name: string; price: number }
export interface Item {
  id: string; categoryId: string; name: string; price: number; vatClass: VatClass;
  discountCategory: string | null; barcode: string | null; modifiers: Modifier[]; sort: number;
}
export interface DiningTable { id: string; name: string; seats: number; area: string }

export interface CheckLine {
  id: string; itemId: string | null; name: string; unitPrice: number; qtyMilli: number; vatClass: VatClass;
  category: string | null; modifiers: Modifier[]; note: string | null; sent: boolean;
}
export interface Check {
  id: string; tableId: string | null; label: string; guests: number; serverId: string; stage: Stage;
  openedAt: string; lines: CheckLine[]; specials: SpecialDiscountInput[]; buyer: Buyer | null; billSeq: number | null;
}
export interface CheckView extends Check { serverName: string; gross: number; due: number; minutesOpen: number }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sell_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('cashier','supervisor','owner')), pin_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS category (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS item (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES category(id), name TEXT NOT NULL, price INTEGER NOT NULL CHECK (price >= 0),
  vat_class TEXT NOT NULL CHECK (vat_class IN ('VATABLE','EXEMPT','ZERO')), discount_category TEXT, barcode TEXT UNIQUE,
  modifiers TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS dining_table (id TEXT PRIMARY KEY, name TEXT NOT NULL, seats INTEGER NOT NULL, area TEXT NOT NULL DEFAULT 'Main', sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS open_check (
  id TEXT PRIMARY KEY, table_id TEXT, label TEXT NOT NULL, guests INTEGER NOT NULL, server_id TEXT NOT NULL, stage TEXT NOT NULL,
  opened_at TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
  invoice_seq INTEGER, closed_at TEXT
);
`;

export function toSaleLines(c: Check): SaleLine[] {
  return c.lines.map((l) => ({
    description: l.modifiers.length ? `${l.name} (${l.modifiers.map((m) => m.name).join(', ')})` : l.name,
    qtyMilli: l.qtyMilli,
    unitPrice: l.unitPrice + l.modifiers.reduce((a, m) => a + m.price, 0),
    vatClass: l.vatClass,
    category: l.category ?? undefined,
  }));
}


const uid = () => crypto.randomUUID();
const pinHash = (staffId: string, pin: string) => sha256hex(`monset-pos-pin|${staffId}|${pin}`);

export function openSell(db: Db, core: Core, opts: { now?: () => Date } = {}) {
  db.exec(SCHEMA);
  const now = opts.now ?? (() => new Date());

  const tx = core.transaction;

  const staffById = (id: string) => db.get<Staff>(`SELECT id, name, role FROM staff WHERE id = ? AND active = 1`, id);
  const rowToItem = (r: Record<string, unknown>): Item => ({
    id: r.id as string, categoryId: r.category_id as string, name: r.name as string, price: r.price as number, vatClass: r.vat_class as VatClass,
    discountCategory: (r.discount_category as string) ?? null, barcode: (r.barcode as string) ?? null, modifiers: JSON.parse(r.modifiers as string), sort: r.sort as number,
  });
  const loadCheck = (id: string): Check => {
    const r = db.get<Record<string, unknown>>(`SELECT * FROM open_check WHERE id = ? AND status = 'open'`, id);
    if (!r) throw new CoreError('NO_CHECK', 'that check is no longer open');
    const d = JSON.parse(r.data as string);
    return {
      id: r.id as string, tableId: (r.table_id as string) ?? null, label: r.label as string, guests: r.guests as number, serverId: r.server_id as string,
      stage: r.stage as Stage, openedAt: r.opened_at as string, lines: d.lines, specials: d.specials, buyer: d.buyer ?? null, billSeq: d.billSeq ?? null,
    };
  };
  const saveCheck = (c: Check) =>
    db.run(
      `UPDATE open_check SET label = ?, guests = ?, server_id = ?, stage = ?, table_id = ?, data = ? WHERE id = ?`,
      c.label, c.guests, c.serverId, c.stage, c.tableId, JSON.stringify({ lines: c.lines, specials: c.specials, buyer: c.buyer, billSeq: c.billSeq }), c.id,
    );

  /** Rules for the discount types in effect today, for previews before anything is posted. */
  function ruleLookup(): (code: string) => DiscountRule | undefined {
    const rules = new Map(core.discountTypes().map((r) => [r.code, r]));
    return (c) => rules.get(c);
  }
  const vatMode = () => core.state().terminal!.vat_mode;
  const vatRate = () => core.rule<{ rateBp: number }>('VAT_RATE', now().toISOString().slice(0, 10)).rateBp;

  /** What the check would cost right now, priced by the same engine that will post it. */
  function preview(c: Check) {
    if (!c.lines.length) return { gross: 0, due: 0, totals: null };
    const p = priceSale(toSaleLines(c), vatMode(), vatRate(), c.specials, ruleLookup());
    return { gross: p.totals.gross, due: p.totals.net, totals: p.totals, specialDiscounts: p.specialDiscounts };
  }

  function requireRole(staffId: string, roles: Role[]) {
    const s = staffById(staffId);
    if (!s || !roles.includes(s.role)) throw new CoreError('NOT_ALLOWED', `this needs a ${roles.join(' or ')}`);
    return s;
  }

  /** A supervisor or owner confirms an action with their own PIN. Logged either way. */
  function approve(pin: string, action: string): Staff {
    const all = db.all<Staff & { pin_hash: string }>(`SELECT id, name, role, pin_hash FROM staff WHERE active = 1 AND role IN ('supervisor','owner')`);
    const s = all.find((x) => x.pin_hash === pinHash(x.id, pin));
    core.record(s?.id ?? 'unknown', s ? 'APPROVAL' : 'APPROVAL_FAILED', action);
    if (!s) throw new CoreError('NOT_ALLOWED', 'a supervisor PIN is needed');
    return { id: s.id, name: s.name, role: s.role };
  }

  return {
    /* ---------- staff ---------- */
    hasStaff: () => !!db.get(`SELECT 1 FROM staff LIMIT 1`),
    addStaff(byId: string | null, s: { name: string; role: Role; pin: string }) {
      return tx(() => {
        const first = !db.get(`SELECT 1 FROM staff LIMIT 1`);
        if (!first) requireRole(byId ?? '', ['owner']);
        if (first && s.role !== 'owner') throw new CoreError('NOT_ALLOWED', 'the first account must be the owner');
        if (!/^\d{4,6}$/.test(s.pin)) throw new CoreError('BAD_PIN', 'PIN must be 4 to 6 digits');
        if (!s.name?.trim()) throw new CoreError('BAD_STAFF', 'enter a name');
        // Readable, stable IDs ("bea-03"): they print on documents and fill the activity log.
        const n = db.get<{ n: number }>(`SELECT count(*) + 1 AS n FROM staff`)!.n;
        const id = `${s.name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'staff'}-${String(n).padStart(2, '0')}`;
        db.run(`INSERT INTO staff (id, name, role, pin_hash) VALUES (?,?,?,?)`, id, s.name.trim(), s.role, pinHash(id, s.pin));
        core.record(byId ?? id, 'PERMISSION_CHANGE', `staff ${s.name.trim()}`, null, { role: s.role });
        return id;
      });
    },
    listStaff: () => db.all<Staff>(`SELECT id, name, role FROM staff WHERE active = 1 ORDER BY role DESC, name`),
    /** PIN sign-in. Every attempt, good or bad, is in the activity log. */
    login(pin: string): Staff {
      const all = db.all<Staff & { pin_hash: string }>(`SELECT id, name, role, pin_hash FROM staff WHERE active = 1`);
      const s = all.find((x) => x.pin_hash === pinHash(x.id, pin));
      core.record(s?.id ?? 'unknown', s ? 'LOGIN' : 'LOGIN_FAILED');
      if (!s) throw new CoreError('BAD_PIN', 'that PIN does not match anyone');
      return { id: s.id, name: s.name, role: s.role };
    },
    approve,
    logout: (staffId: string) => core.record(staffId, 'LOGOUT'),

    /* ---------- catalog ---------- */
    menu() {
      return {
        categories: db.all<Category>(`SELECT id, name, sort FROM category ORDER BY sort, name`),
        items: db.all<Record<string, unknown>>(`SELECT * FROM item WHERE active = 1 ORDER BY sort, name`).map(rowToItem),
        tables: db.all<DiningTable>(`SELECT id, name, seats, area FROM dining_table ORDER BY sort, name`),
      };
    },
    saveCategory(byId: string, c: { id?: string; name: string; sort?: number }) {
      requireRole(byId, ['owner', 'supervisor']);
      const id = c.id ?? uid();
      db.run(`INSERT INTO category (id, name, sort) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort = excluded.sort`, id, c.name, c.sort ?? 0);
      return id;
    },
    saveItem(byId: string, i: Omit<Item, 'id' | 'sort' | 'modifiers' | 'barcode' | 'discountCategory'> & Partial<Item>) {
      requireRole(byId, ['owner', 'supervisor']);
      if (!Number.isSafeInteger(i.price) || i.price < 0) throw new CoreError('BAD_ITEM', 'price must be whole centavos');
      const id = i.id ?? uid();
      const before = db.get(`SELECT * FROM item WHERE id = ?`, id) ?? null;
      db.run(
        `INSERT INTO item (id, category_id, name, price, vat_class, discount_category, barcode, modifiers, sort) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, name = excluded.name, price = excluded.price, vat_class = excluded.vat_class,
           discount_category = excluded.discount_category, barcode = excluded.barcode, modifiers = excluded.modifiers, sort = excluded.sort`,
        id, i.categoryId, i.name, i.price, i.vatClass, i.discountCategory ?? null, i.barcode ?? null, JSON.stringify(i.modifiers ?? []), i.sort ?? 0,
      );
      core.record(byId, 'SETTINGS_CHANGE', `item ${i.name}`, before, { price: i.price, vatClass: i.vatClass });
      return id;
    },
    saveTable(byId: string, t: { id?: string; name: string; seats: number; area?: string; sort?: number }) {
      requireRole(byId, ['owner', 'supervisor']);
      const id = t.id ?? uid();
      db.run(`INSERT INTO dining_table (id, name, seats, area, sort) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, seats = excluded.seats, area = excluded.area, sort = excluded.sort`, id, t.name, t.seats, t.area ?? 'Main', t.sort ?? 0);
      return id;
    },
    itemByBarcode: (code: string) => {
      const r = db.get<Record<string, unknown>>(`SELECT * FROM item WHERE barcode = ? AND active = 1`, code.trim());
      return r ? rowToItem(r) : null;
    },

    /* ---------- open checks ---------- */
    board(): CheckView[] {
      const t = now().getTime();
      const names = new Map(db.all<Staff>(`SELECT id, name, role FROM staff`).map((s) => [s.id, s.name]));
      return db.all<{ id: string }>(`SELECT id FROM open_check WHERE status = 'open' ORDER BY opened_at`).map(({ id }) => {
        const c = loadCheck(id);
        const p = preview(c);
        return { ...c, serverName: names.get(c.serverId) ?? '?', gross: p.gross, due: p.due, minutesOpen: Math.floor((t - Date.parse(c.openedAt)) / 60_000) };
      });
    },
    check(id: string) {
      const c = loadCheck(id);
      return { check: c, preview: preview(c) };
    },
    openCheck(byId: string, o: { tableId?: string | null; label?: string; guests: number }) {
      return tx(() => {
        requireRole(byId, ['cashier', 'supervisor', 'owner']);
        const table = o.tableId ? db.get<DiningTable>(`SELECT * FROM dining_table WHERE id = ?`, o.tableId) : null;
        if (o.tableId && !table) throw new CoreError('NO_TABLE', 'unknown table');
        if (table && db.get(`SELECT 1 FROM open_check WHERE table_id = ? AND status = 'open'`, table.id)) throw new CoreError('TABLE_BUSY', `${table.name} already has an open check`);
        if (!Number.isInteger(o.guests) || o.guests < 1) throw new CoreError('BAD_CHECK', 'guests must be at least 1');
        const id = uid();
        const label = table?.name ?? (o.label?.trim() || `Take out ${db.get<{ n: number }>(`SELECT count(*) + 1 AS n FROM open_check WHERE table_id IS NULL`)!.n}`);
        db.run(
          `INSERT INTO open_check (id, table_id, label, guests, server_id, stage, opened_at, data) VALUES (?,?,?,?,?,?,?,?)`,
          id, table?.id ?? null, label, o.guests, byId, 'seated', now().toISOString(), JSON.stringify({ lines: [], specials: [], buyer: null, billSeq: null }),
        );
        return id;
      });
    },
    addItem(byId: string, checkId: string, itemId: string, o: { qtyMilli?: number; modifiers?: Modifier[]; note?: string } = {}) {
      return tx(() => {
        const c = loadCheck(checkId);
        const r = db.get<Record<string, unknown>>(`SELECT * FROM item WHERE id = ? AND active = 1`, itemId);
        if (!r) throw new CoreError('NO_ITEM', 'that item is not on the menu');
        const it = rowToItem(r);
        const mods = (o.modifiers ?? []).filter((m) => it.modifiers.some((x) => x.name === m.name && x.price === m.price));
        const qty = o.qtyMilli ?? 1000;
        if (!Number.isSafeInteger(qty) || qty <= 0) throw new CoreError('BAD_QTY', 'quantity must be positive');
        // Same item, same options, not yet sent: bump the quantity instead of adding a row.
        const same = c.lines.find((l) => !l.sent && l.itemId === it.id && JSON.stringify(l.modifiers) === JSON.stringify(mods) && !l.note && !o.note);
        if (same) same.qtyMilli += qty;
        else c.lines.push({ id: uid(), itemId: it.id, name: it.name, unitPrice: it.price, qtyMilli: qty, vatClass: it.vatClass, category: it.discountCategory, modifiers: mods, note: o.note?.trim() || null, sent: false });
        if (c.stage === 'billout') c.stage = 'ordered'; // they ordered more after asking for the bill
        void byId;
        saveCheck(c);
      });
    },
    setQty(byId: string, checkId: string, lineId: string, qtyMilli: number, approverPin?: string) {
      return tx(() => {
        const c = loadCheck(checkId);
        const l = c.lines.find((x) => x.id === lineId);
        if (!l) throw new CoreError('NO_LINE', 'line not found');
        if (!Number.isSafeInteger(qtyMilli) || qtyMilli < 0) throw new CoreError('BAD_QTY', 'quantity cannot be negative');
        // Taking back something the kitchen already has needs a supervisor, and is logged.
        if (l.sent && qtyMilli < l.qtyMilli) {
          const sup = approve(approverPin ?? '', `reduce ${l.name}`);
          core.record(byId, 'ORDER_LINE_CANCEL', `${c.label}: ${l.name}`, { qtyMilli: l.qtyMilli }, { qtyMilli, approvedBy: sup.id });
        }
        if (qtyMilli === 0) c.lines = c.lines.filter((x) => x.id !== lineId);
        else l.qtyMilli = qtyMilli;
        saveCheck(c);
      });
    },
    sendToKitchen(byId: string, checkId: string) {
      return tx(() => {
        const c = loadCheck(checkId);
        const unsent = c.lines.filter((l) => !l.sent);
        if (!unsent.length) throw new CoreError('NOTHING_TO_SEND', 'nothing new to send');
        unsent.forEach((l) => (l.sent = true));
        if (c.stage === 'seated' || c.stage === 'served' || c.stage === 'billout') c.stage = 'ordered';
        saveCheck(c);
        core.record(byId, 'ORDER_SENT', c.label, null, { lines: unsent.map((l) => ({ name: l.name, qtyMilli: l.qtyMilli })) });
        return unsent;
      });
    },
    setStage(byId: string, checkId: string, stage: Stage) {
      return tx(() => {
        const c = loadCheck(checkId);
        if (!STAGES.includes(stage)) throw new CoreError('BAD_STAGE', 'unknown stage');
        c.stage = stage;
        void byId;
        saveCheck(c);
      });
    },
    setGuests(byId: string, checkId: string, guests: number) {
      return tx(() => {
        const c = loadCheck(checkId);
        if (!Number.isInteger(guests) || guests < 1) throw new CoreError('BAD_CHECK', 'guests must be at least 1');
        c.guests = guests;
        void byId;
        saveCheck(c);
      });
    },
    /** Senior / PWD / NAAC / Solo parent cards on this check. Validated now so the cashier hears about problems before paying. */
    setSpecials(byId: string, checkId: string, specials: SpecialDiscountInput[]) {
      return tx(() => {
        const c = loadCheck(checkId);
        priceSale(toSaleLines({ ...c, lines: c.lines.length ? c.lines : [] }), vatMode(), vatRate(), specials, ruleLookup());
        const before = c.specials;
        c.specials = specials;
        saveCheck(c);
        core.record(byId, 'DISCOUNT_SET', c.label, { count: before.length }, { types: specials.map((s) => s.type) });
      });
    },
    setBuyer(byId: string, checkId: string, buyer: Buyer | null) {
      return tx(() => {
        const c = loadCheck(checkId);
        c.buyer = buyer;
        void byId;
        saveCheck(c);
      });
    },
    /** The bill handed to the table before paying is a supplementary document, never an invoice. */
    printBill(byId: string, online: boolean, checkId: string) {
      const c = loadCheck(checkId);
      if (!c.lines.length) throw new CoreError('EMPTY', 'nothing on this check yet');
      const posted = core.issueSupplementary({ userId: byId, online, type: 'ORDER', lines: toSaleLines(c), reference: `${c.label} (bill, ${c.guests} guests)` });
      tx(() => {
        const fresh = loadCheck(checkId);
        fresh.stage = 'billout';
        fresh.billSeq = posted.seq;
        saveCheck(fresh);
      });
      return posted;
    },
    /** Pay and close: the one place an invoice is issued from a check. */
    pay(byId: string, online: boolean, checkId: string, payments: Payment[]) {
      const c = loadCheck(checkId);
      if (!c.lines.length) throw new CoreError('EMPTY', 'nothing to pay for');
      const posted = core.postSale({ userId: byId, online, lines: toSaleLines(c), payments, specialDiscounts: c.specials, buyer: c.buyer ?? undefined });
      // ponytail: invoice and check closure are two transactions. If the app dies between them the
      // invoice stands (it is the record) and the check stays open; reopening shows it as already paid below.
      db.run(`UPDATE open_check SET status = 'paid', invoice_seq = ?, closed_at = ? WHERE id = ?`, posted.seq, now().toISOString(), checkId);
      return posted;
    },
    /** Retail or takeout without a check. */
    quickSale(byId: string, online: boolean, lines: SaleLine[], payments: Payment[], specials: SpecialDiscountInput[] = [], buyer?: Buyer) {
      return core.postSale({ userId: byId, online, lines, payments, specialDiscounts: specials, buyer });
    },
    previewLines(lines: SaleLine[], specials: SpecialDiscountInput[] = []) {
      return lines.length ? priceSale(lines, vatMode(), vatRate(), specials, ruleLookup()) : null;
    },
    cancelCheck(byId: string, checkId: string, reason: string, approverPin?: string) {
      return tx(() => {
        const c = loadCheck(checkId);
        if (!reason?.trim()) throw new CoreError('REASON_REQUIRED', 'give a reason');
        const anySent = c.lines.some((l) => l.sent);
        const sup = anySent ? approve(approverPin ?? '', `cancel ${c.label}`) : null;
        db.run(`UPDATE open_check SET status = 'cancelled', closed_at = ? WHERE id = ?`, now().toISOString(), checkId);
        core.record(byId, 'CHECK_CANCEL', c.label, { lines: c.lines.length }, { reason: reason.trim(), approvedBy: sup?.id ?? null });
      });
    },
    moveTable(byId: string, checkId: string, tableId: string) {
      return tx(() => {
        const c = loadCheck(checkId);
        const t = db.get<DiningTable>(`SELECT * FROM dining_table WHERE id = ?`, tableId);
        if (!t) throw new CoreError('NO_TABLE', 'unknown table');
        if (db.get(`SELECT 1 FROM open_check WHERE table_id = ? AND status = 'open' AND id != ?`, tableId, checkId)) throw new CoreError('TABLE_BUSY', `${t.name} already has an open check`);
        c.tableId = t.id;
        c.label = t.name;
        saveCheck(c);
        core.record(byId, 'CHECK_MOVE', c.label, null, { to: t.name });
      });
    },
    /** Merge another check into this one (tables pushed together). */
    merge(byId: string, intoId: string, fromId: string) {
      return tx(() => {
        const into = loadCheck(intoId);
        const from = loadCheck(fromId);
        into.lines.push(...from.lines);
        into.guests += from.guests;
        into.specials.push(...from.specials);
        saveCheck(into);
        db.run(`UPDATE open_check SET status = 'cancelled', closed_at = ? WHERE id = ?`, now().toISOString(), fromId);
        core.record(byId, 'CHECK_MERGE', into.label, null, { merged: from.label });
      });
    },
    /** Split chosen lines (and quantities) off into a new check for separate payment. */
    split(byId: string, checkId: string, take: { lineId: string; qtyMilli: number }[]) {
      return tx(() => {
        const c = loadCheck(checkId);
        const moved: CheckLine[] = [];
        for (const t of take) {
          const l = c.lines.find((x) => x.id === t.lineId);
          if (!l || t.qtyMilli <= 0 || t.qtyMilli > l.qtyMilli) throw new CoreError('BAD_SPLIT', 'choose quantities that are on the check');
          moved.push({ ...l, id: uid(), qtyMilli: t.qtyMilli });
          l.qtyMilli -= t.qtyMilli;
        }
        c.lines = c.lines.filter((l) => l.qtyMilli > 0);
        if (!moved.length) throw new CoreError('BAD_SPLIT', 'nothing chosen');
        const id = uid();
        db.run(
          `INSERT INTO open_check (id, table_id, label, guests, server_id, stage, opened_at, data) VALUES (?,?,?,?,?,?,?,?)`,
          id, null, `${c.label} (split)`, 1, c.serverId, c.stage, c.openedAt, JSON.stringify({ lines: moved, specials: [], buyer: null, billSeq: null }),
        );
        saveCheck(c);
        core.record(byId, 'CHECK_SPLIT', c.label, null, { lines: moved.length });
        return id;
      });
    },
  };
}

export type Sell = ReturnType<typeof openSell>;
