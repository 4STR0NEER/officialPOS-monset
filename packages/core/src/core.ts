import type { Db, Param } from './port.ts';
import { migrate, type DocType } from './schema.ts';
import { canonical, CoreError, GENESIS_HASH, isCentavos, mulDiv } from './util.ts';
import {
  apportion, priceSale, settle, splitByClass,
  type DiscountRule, type Payment, type PricedLine, type SaleLine, type SpecialDiscountInput, type Totals, type VatClass, type VatMode,
} from './totals.ts';
import { applyEntry, fingerprint, hashActivity, hashEntry, nextNumber, verifyAll, type Accumulators, type EntryRow, type Issue } from './verify.ts';
import { summarize, type Reading } from './readings.ts';
import { buildBlocks, COLUMNS, LAYOUT_VERSION, localTime, renderEscPos, renderHtml, renderText, withReprintBanner, type Block, type Paper } from './documents.ts';
import { newSealKey, signSeal } from './seal.ts';

/** The accredited compliance-core version. Printed on every document. Must equal packages/core/package.json. */
export const CORE_VERSION = '0.2.0';

export type LicenseMode = 'LIVE' | 'DEMO' | 'NON_INVOICING';

export interface TerminalRow {
  terminal_id: string;
  device_id: string;
  mode: LicenseMode;
  vat_mode: VatMode;
  min: string | null;
  serial: string | null;
  sln: string | null;
  ptu_no: string | null;
  ptu_date: string | null;
  ptu_label: string;
  paper: Paper;
  created_at: string;
}

export interface TerminalInit {
  terminalId: string;
  deviceId: string;
  mode: LicenseMode;
  vatMode: VatMode;
  min?: string;
  serial?: string;
  sln?: string;
  ptuNo?: string;
  ptuDate?: string;
  ptuLabel?: string; // "PTU No." or "AC No." (Q6)
  paper?: Paper;
}

export type TerminalPatch = Partial<Pick<TerminalInit, 'min' | 'serial' | 'sln' | 'ptuNo' | 'ptuDate' | 'ptuLabel' | 'paper' | 'vatMode'>>;

export interface Seller {
  registeredName: string;
  businessName?: string;
  address: string;
  tin: string; // 9 digits; branch code optional (defaults to 00000)
}

export interface Supplier {
  name: string;
  address: string;
  tin: string;
  accreditationNo: string;
  accreditationIssued: string;
  accreditationValidUntil: string;
}

export interface Buyer {
  name?: string;
  address?: string;
  tin?: string;
  businessStyle?: string;
  vatRegistered?: boolean; // VAT-registered buyers must give name, address and TIN
}

export interface SaleInput {
  userId: string;
  online: boolean; // could this device reach the hub when the sale was made
  lines: SaleLine[];
  payments: Payment[];
  buyer?: Buyer;
  specialDiscounts?: SpecialDiscountInput[];
}

export interface ReversalInput {
  userId: string;
  online: boolean;
  type: 'VOID' | 'REFUND' | 'RETURN';
  invoiceSeq: number;
  reason: string;
  approvedBy?: string;
  lines?: { lineNo: number; qtyMilli: number }[]; // REFUND / RETURN only
  refundMethod?: string; // REFUND / RETURN, default CASH
}

export interface SupplementaryInput {
  userId: string;
  online: boolean;
  type: 'ORDER' | 'ACK' | 'COLLECTION';
  lines?: SaleLine[]; // ORDER
  amount?: number; // ACK / COLLECTION, centavos
  payments?: Payment[];
  party?: Buyer;
  reference?: string; // what the money or order is for
  memo?: string;
}

export interface ManualInvoiceInput {
  userId: string;
  online: boolean;
  manualNo: string; // number on the BIR-registered manual invoice booklet
  issuedOn: string; // YYYY-MM-DD the manual invoice was written
  lines: SaleLine[];
  buyer?: Buyer;
  linkedInvoiceSeq?: number; // the system invoice it stands in for, if any
  reason: string;
}

export interface Posted {
  seq: number;
  docType: DocType;
  docNo: number;
  number: string;
  resetCounter: number;
  issuedAt: string;
  offline: boolean;
  hash: string;
  text: string; // the e-journal text, at the terminal's paper width
}

export interface HighWater {
  terminalId: string;
  seq: number;
  resetCounter: number;
  grandTotal: number;
  zCounter: number;
}

export interface CoreOptions {
  now?: () => Date;
  tzOffsetMinutes?: number; // business date offset; Philippines is +08:00 with no DST
  clockToleranceMs?: number; // how far behind the last document the clock may be before issuing is refused
}

const ACC_COLS = 'grand_total, reset_counter, z_counter, void_count, void_total, refund_count, refund_total, return_count, return_total';
const SUPPLEMENTARY_TYPES = ['ORDER', 'ACK', 'COLLECTION'];

/** "123456789" or "123-456-789-00001" -> "123-456-789-00001". */
export function formatTin(raw: string): string {
  const d = String(raw ?? '').replace(/[\s-]/g, '');
  if (!/^\d{9}(\d{5})?$/.test(d)) throw new CoreError('BAD_TIN', `TIN must be 9 digits plus an optional 5-digit branch code: ${raw}`);
  const b = d.length === 14 ? d.slice(9) : '00000';
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 9)}-${b}`;
}

function cleanBuyer(b: Buyer | undefined): Buyer | null {
  if (!b) return null;
  const out: Buyer = {};
  for (const k of ['name', 'address', 'businessStyle'] as const) if (b[k]?.trim()) out[k] = b[k]!.trim();
  if (b.tin?.trim()) out.tin = formatTin(b.tin);
  if (b.vatRegistered) {
    if (!out.name || !out.address || !out.tin) throw new CoreError('BUYER_REQUIRED', 'a VAT-registered buyer needs name, address and TIN on the invoice');
    out.vatRegistered = true;
  }
  return Object.keys(out).length ? out : null;
}

export function openCore(db: Db, opts: CoreOptions = {}) {
  migrate(db);
  const now = opts.now ?? (() => new Date());
  const tzMinutes = opts.tzOffsetMinutes ?? 480;
  const toleranceMs = opts.clockToleranceMs ?? 5_000;
  let locked = false;
  let lastIssues: Issue[] = [];

  const terminal = () => db.get<TerminalRow>(`SELECT * FROM terminal WHERE id = 1`);
  const mustTerminal = () => {
    const t = terminal();
    if (!t) throw new CoreError('NO_TERMINAL', 'terminal is not set up yet');
    return t;
  };
  const accumulators = () => db.get<Accumulators>(`SELECT ${ACC_COLS} FROM accumulator WHERE id = 1`)!;
  const businessDate = (at: Date) => new Date(at.getTime() + tzMinutes * 60_000).toISOString().slice(0, 10);
  const series = (t: string) => db.get<{ next_no: number; width: number; reset_counter: number }>(`SELECT * FROM doc_series WHERE doc_type = ?`, t)!;
  const pad = (t: string, no: number) => String(no).padStart(series(t).width, '0');
  const lastZ = () => db.get<EntryRow>(`SELECT * FROM ledger_entry WHERE doc_type = 'Z' ORDER BY seq DESC LIMIT 1`);
  const entry = (seq: number) => db.get<EntryRow>(`SELECT * FROM ledger_entry WHERE seq = ?`, seq);
  const setting = <T>(key: string) => {
    const r = db.get<{ value: string }>(`SELECT value FROM setting WHERE key = ?`, key);
    return r ? (JSON.parse(r.value) as T) : null;
  };
  const putSetting = (key: string, value: unknown) =>
    db.run(`INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, canonical(value));

  // Nested calls (a business module's transaction calling into the core) become savepoints,
  // so a module's change and the activity rows it causes commit together or not at all.
  let depth = 0;
  function tx<T>(fn: () => T): T {
    const sp = `sp${depth}`;
    db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    depth++;
    try {
      const r = fn();
      depth--;
      db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      return r;
    } catch (e) {
      depth--;
      db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw e;
    }
  }

  function log(userId: string, action: string, object: string | null = null, before: unknown = null, after: unknown = null) {
    const last = db.get<{ id: number; hash: string }>(`SELECT id, hash FROM activity_log ORDER BY id DESC LIMIT 1`);
    const r = {
      id: (last?.id ?? 0) + 1,
      at: now().toISOString(),
      user_id: userId,
      device_id: terminal()?.device_id ?? 'unregistered',
      action,
      object,
      before_json: before == null ? null : canonical(before),
      after_json: after == null ? null : canonical(after),
      prev_hash: last?.hash ?? GENESIS_HASH,
    };
    db.run(
      `INSERT INTO activity_log (id, at, user_id, device_id, action, object, before_json, after_json, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      r.id, r.at, r.user_id, r.device_id, r.action, r.object, r.before_json, r.after_json, r.prev_hash, hashActivity(r),
    );
  }

  /** Run fn in a transaction; if the core refuses, record the refused attempt after rolling back. */
  function audited<T>(userId: string, action: string, fn: () => T): T {
    try {
      return tx(fn);
    } catch (e) {
      if (e instanceof CoreError) tx(() => log(userId, 'REJECTED', action, null, { code: e.code, message: e.message }));
      throw e;
    }
  }

  function rule<T>(kind: string, date: string): T | undefined {
    const r = db.get<{ payload: string }>(
      `SELECT payload FROM rule_set WHERE kind = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1`, kind, date,
    );
    return r ? (JSON.parse(r.payload) as T) : undefined;
  }
  function mustRule<T>(kind: string, date: string): T {
    const r = rule<T>(kind, date);
    if (!r) throw new CoreError('NO_RULE', `no ${kind} rule in effect on ${date}`);
    return r;
  }

  /** What the top and bottom of every document show, frozen into the document itself. */
  function header() {
    const t = mustTerminal();
    return {
      seller: setting<Seller>('seller'),
      supplier: setting<Supplier>('supplier'),
      terminal: {
        terminalId: t.terminal_id, min: t.min, serial: t.serial, sln: t.sln, ptuLabel: t.ptu_label, ptuNo: t.ptu_no, ptuDate: t.ptu_date,
        mode: t.mode, vatMode: t.vat_mode, paper: t.paper,
      },
    };
  }

  function sealKey(): { secret: string; public: string } {
    let k = setting<{ secret: string; public: string }>('seal_key');
    if (!k) putSetting('seal_key', (k = newSealKey()));
    return k;
  }

  /**
   * The one way anything enters the ledger. Number, hash, totals, journal and outbox move together
   * or not at all. `decorate` adds fields that depend on the number (the invoice seal) before hashing.
   */
  function append(
    at: Date, docType: DocType, userId: string, online: boolean, body: object,
    reverses?: EntryRow, decorate?: (m: { number: string; reset: number; issuedAt: string }) => object,
  ): Posted {
    if (locked) throw new CoreError('LOCKED', 'integrity check found a problem; a supervisor must review it before anything is issued');
    const t = mustTerminal();
    if (docType === 'INVOICE' && t.mode === 'NON_INVOICING') throw new CoreError('NON_INVOICING', 'this installation is licensed for ordering only and cannot issue invoices');

    const last = db.get<{ seq: number; hash: string; issued_at: string }>(`SELECT seq, hash, issued_at FROM ledger_entry ORDER BY seq DESC LIMIT 1`);
    if (last) {
      const behind = Date.parse(last.issued_at) - at.getTime();
      if (behind > toleranceMs) throw new CoreError('CLOCK_BEHIND', `device clock is ${Math.ceil(behind / 1000)}s behind the last document; correct the clock first`);
      if (behind > 0) log(userId, 'CLOCK_ANOMALY', docType, { lastIssuedAt: last.issued_at }, { issuedAt: at.toISOString() });
    }

    const s = series(docType);
    const after = nextNumber(s.next_no, s.reset_counter, s.width);
    db.run(`UPDATE doc_series SET next_no = ?, reset_counter = ? WHERE doc_type = ?`, after.no, after.reset, docType);
    const number = String(s.next_no).padStart(s.width, '0');
    const issuedAt = at.toISOString();
    const full = { ...body, header: header(), ...decorate?.({ number, reset: s.reset_counter, issuedAt }) };

    const row: Omit<EntryRow, 'hash'> = {
      seq: (last?.seq ?? 0) + 1,
      doc_type: docType,
      doc_no: s.next_no,
      series_reset: s.reset_counter,
      reverses_seq: reverses?.seq ?? null,
      issued_at: issuedAt,
      business_date: businessDate(at),
      created_offline: online ? 0 : 1,
      device_id: t.device_id,
      user_id: userId,
      core_version: CORE_VERSION,
      body: canonical(full),
      prev_hash: last?.hash ?? GENESIS_HASH,
    };
    const hash = hashEntry(row);
    db.run(
      `INSERT INTO ledger_entry (seq, doc_type, doc_no, series_reset, reverses_seq, issued_at, business_date, created_offline, device_id, user_id, core_version, body, prev_hash, hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      row.seq, row.doc_type, row.doc_no, row.series_reset, row.reverses_seq, row.issued_at, row.business_date,
      row.created_offline, row.device_id, row.user_id, row.core_version, row.body, row.prev_hash, hash,
    );

    const a = applyEntry(accumulators(), docType, full as { totals?: { gross: number; net: number } });
    db.run(
      `UPDATE accumulator SET ${ACC_COLS.split(', ').map((c) => `${c} = ?`).join(', ')} WHERE id = 1`,
      ...(ACC_COLS.split(', ').map((c) => a[c as keyof Accumulators]) as Param[]),
    );

    const blocks = buildBlocks(
      { docType, number, resetCounter: row.series_reset, issuedAt, offline: !online, userId, coreVersion: CORE_VERSION, tzMinutes },
      JSON.parse(row.body),
    );
    const text = renderText(blocks, COLUMNS[t.paper]);
    db.run(`INSERT INTO journal (seq, layout_version, text, blocks) VALUES (?, ?, ?, ?)`, row.seq, LAYOUT_VERSION, text, JSON.stringify(blocks));
    db.run(`INSERT INTO outbox (seq) VALUES (?)`, row.seq);
    log(userId, 'ISSUE', `${docType} ${number}`, null, { seq: row.seq, hash });

    return { seq: row.seq, docType, docNo: row.doc_no, number, resetCounter: row.series_reset, issuedAt, offline: !online, hash, text };
  }

  function ackedFingerprints(): Set<string> {
    const s = new Set<string>();
    for (const r of db.all<{ after_json: string }>(`SELECT after_json FROM activity_log WHERE action = 'INTEGRITY_ACK'`)) {
      for (const f of JSON.parse(r.after_json).fingerprints as string[]) s.add(f);
    }
    return s;
  }

  /** Re-verify everything; lock issuing while any problem is unacknowledged. */
  function check(userId = 'system') {
    lastIssues = verifyAll(db);
    const acked = ackedFingerprints();
    const open = lastIssues.filter((i) => !acked.has(fingerprint(i)));
    locked = open.length > 0;
    if (locked) tx(() => log(userId, 'INTEGRITY_BREAK', null, null, { issues: open }));
    return { ok: open.length === 0, issues: lastIssues, open };
  }

  function reading(kind: 'X' | 'Z', userId: string, online: boolean) {
    if (kind === 'Z') check(userId); // never close a day on a broken ledger
    return audited(userId, `${kind}_READING`, () => {
      const at = now();
      const z = lastZ();
      const prev = z ? (JSON.parse(z.body) as Reading) : null;
      const rows = db.all<EntryRow>(`SELECT * FROM ledger_entry WHERE seq > ? ORDER BY seq`, z?.seq ?? 0);
      const a = accumulators();
      const r = summarize(
        kind,
        rows,
        { fromSeq: (z?.seq ?? 0) + 1, grandTotal: prev?.endGrandTotal ?? 0, resetCounter: prev?.endResetCounter ?? 0 },
        { grandTotal: a.grand_total, resetCounter: a.reset_counter, zCounter: a.z_counter + (kind === 'Z' ? 1 : 0) },
      );
      const fmt = (n: number | null) => (n == null ? null : pad('INVOICE', n));
      const body = { ...r, beginInvoice: fmt(r.beginInvoiceNo), endInvoice: fmt(r.endInvoiceNo) };
      return { posted: append(at, kind, userId, online, body), reading: r };
    });
  }

  const discountRuleOn = (date: string) => (code: string) => rule<DiscountRule>(`DISCOUNT_TYPE:${code}`, date);

  function priceFor(at: Date, lines: SaleLine[], specials: SpecialDiscountInput[] = []) {
    const t = mustTerminal();
    const date = businessDate(at);
    const { rateBp } = mustRule<{ rateBp: number }>('VAT_RATE', date);
    return { vatMode: t.vat_mode, vatRateBp: rateBp, ...priceSale(lines, t.vat_mode, rateBp, specials, discountRuleOn(date)) };
  }

  function requireSeller() {
    const s = setting<Seller>('seller');
    if (!s) throw new CoreError('NO_SELLER', "set the seller's registered name, address and TIN before issuing invoices");
    return s;
  }

  if (terminal()) check();

  return {
    coreVersion: CORE_VERSION,

    /** For business modules: run their own writes in the same transaction system as the core. */
    transaction: tx,

    initTerminal(userId: string, init: TerminalInit) {
      return audited(userId, 'TERMINAL_INIT', () => {
        if (terminal()) throw new CoreError('TERMINAL_EXISTS', 'this database already belongs to a terminal');
        if (!init.terminalId || !init.deviceId) throw new CoreError('BAD_TERMINAL', 'terminal and device IDs are required');
        if (!['LIVE', 'DEMO', 'NON_INVOICING'].includes(init.mode)) throw new CoreError('BAD_TERMINAL', 'unknown license mode');
        if (!['VAT', 'NONVAT', 'EXEMPT'].includes(init.vatMode)) throw new CoreError('BAD_TERMINAL', 'unknown VAT mode');
        if (init.paper && !(init.paper in COLUMNS)) throw new CoreError('BAD_TERMINAL', 'paper must be 58, 80 or A4');
        db.run(
          `INSERT INTO terminal (id, terminal_id, device_id, mode, vat_mode, min, serial, sln, ptu_no, ptu_date, ptu_label, paper, created_at)
           VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?)`,
          init.terminalId, init.deviceId, init.mode, init.vatMode, init.min ?? null, init.serial ?? null, init.sln ?? null,
          init.ptuNo ?? null, init.ptuDate ?? null, init.ptuLabel ?? 'PTU No.', init.paper ?? '80', now().toISOString(),
        );
        sealKey();
        log(userId, 'TERMINAL_INIT', init.terminalId, null, init);
      });
    },

    /** Registration details arrive after install (MIN, PTU). Mode and identity can never change. */
    updateTerminal(userId: string, patch: TerminalPatch) {
      return audited(userId, 'SETTINGS_CHANGE', () => {
        const before = mustTerminal();
        const cols: Record<string, string> = {
          min: 'min', serial: 'serial', sln: 'sln', ptuNo: 'ptu_no', ptuDate: 'ptu_date', ptuLabel: 'ptu_label', paper: 'paper', vatMode: 'vat_mode',
        };
        const keys = Object.keys(patch).filter((k) => k in cols) as (keyof TerminalPatch)[];
        if (keys.length !== Object.keys(patch).length) throw new CoreError('BAD_SETTING', 'only registration details, paper and VAT mode can be changed');
        if (patch.vatMode && !['VAT', 'NONVAT', 'EXEMPT'].includes(patch.vatMode)) throw new CoreError('BAD_SETTING', 'unknown VAT mode');
        if (patch.paper && !(patch.paper in COLUMNS)) throw new CoreError('BAD_SETTING', 'paper must be 58, 80 or A4');
        for (const k of keys) db.run(`UPDATE terminal SET ${cols[k]} = ? WHERE id = 1`, patch[k] ?? null);
        log(userId, 'SETTINGS_CHANGE', 'terminal', before, terminal());
      });
    },

    /** The client's registered details for the invoice header. */
    configureSeller(userId: string, seller: Seller) {
      return audited(userId, 'SETTINGS_CHANGE', () => {
        if (!seller.registeredName?.trim() || !seller.address?.trim()) throw new CoreError('BAD_SETTING', 'registered name and address are required');
        const clean: Seller = { registeredName: seller.registeredName.trim(), address: seller.address.trim(), tin: formatTin(seller.tin) };
        if (seller.businessName?.trim()) clean.businessName = seller.businessName.trim();
        const before = setting('seller');
        putSetting('seller', clean);
        log(userId, 'SETTINGS_CHANGE', 'seller', before, clean);
      });
    },

    /** Monset's accreditation details for the footer. Placeholders stay until BIR issues them (Q8). */
    configureSupplier(userId: string, patch: Partial<Supplier>) {
      return audited(userId, 'SETTINGS_CHANGE', () => {
        const before = setting<Supplier>('supplier')!;
        const next = { ...before, ...patch };
        putSetting('supplier', next);
        log(userId, 'SETTINGS_CHANGE', 'supplier', before, next);
      });
    },

    /** Rules are never edited: a new row with a later effective date supersedes the old one. */
    addRule(userId: string, kind: string, effectiveFrom: string, payload: object, sourceRef: string) {
      return audited(userId, 'RULE_ADD', () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new CoreError('BAD_RULE', 'effective date must be YYYY-MM-DD');
        if (!sourceRef) throw new CoreError('BAD_RULE', 'cite the regulation the rule comes from');
        db.run(`INSERT INTO rule_set (kind, effective_from, payload, source_ref) VALUES (?,?,?,?)`, kind, effectiveFrom, canonical(payload), sourceRef);
        log(userId, 'RULE_ADD', kind, null, { effectiveFrom, payload, sourceRef });
      });
    },

    rule: mustRule,

    /** Special discount types in effect on a date (data, not code). */
    discountTypes(date = businessDate(now())): DiscountRule[] {
      const kinds = db.all<{ kind: string }>(`SELECT DISTINCT kind FROM rule_set WHERE kind LIKE 'DISCOUNT_TYPE:%' ORDER BY kind`);
      return kinds.map((k) => rule<DiscountRule>(k.kind, date)).filter((r): r is DiscountRule => !!r);
    },

    postSale(i: SaleInput): Posted {
      return audited(i.userId, 'POST_SALE', () => {
        const at = now();
        const seller = requireSeller();
        const p = priceFor(at, i.lines, i.specialDiscounts);
        const { tendered, change } = settle(i.payments, p.totals.net);
        const body = {
          kind: 'INVOICE',
          vatMode: p.vatMode,
          vatRateBp: p.vatRateBp,
          lines: p.lines,
          totals: p.totals,
          specialDiscounts: p.specialDiscounts,
          payments: i.payments.map((x) => ({ method: x.method, amount: x.amount, ref: x.ref ?? null })),
          tendered,
          change,
          buyer: cleanBuyer(i.buyer),
        };
        const t = mustTerminal();
        const key = sealKey();
        return append(at, 'INVOICE', i.userId, i.online, body, undefined, (m) => ({
          seal: signSeal(
            { sln: t.sln ?? '-', tin: seller.tin, min: t.min ?? '-', number: m.number, reset: m.reset, issuedAt: m.issuedAt, amountDue: p.totals.net, vat: p.totals.vat },
            key,
          ),
        }));
      });
    },

    /** Corrections are new documents that point at the original invoice. Nothing is ever edited. */
    postReversal(i: ReversalInput): Posted {
      return audited(i.userId, `POST_${i.type}`, () => {
        const at = now();
        if (!['VOID', 'REFUND', 'RETURN'].includes(i.type)) throw new CoreError('BAD_REVERSAL', 'unknown reversal type');
        if (!i.reason?.trim()) throw new CoreError('REASON_REQUIRED', 'give a reason');
        const orig = entry(i.invoiceSeq);
        if (!orig || orig.doc_type !== 'INVOICE') throw new CoreError('NOT_AN_INVOICE', 'only invoices can be voided, refunded or returned');
        const ob = JSON.parse(orig.body) as { vatMode: VatMode; vatRateBp: number; lines: PricedLine[]; totals: Totals; payments: Payment[]; change: number };
        const prior = db.all<EntryRow>(`SELECT * FROM ledger_entry WHERE reverses_seq = ? ORDER BY seq`, orig.seq);
        if (prior.some((p) => p.doc_type === 'VOID')) throw new CoreError('ALREADY_VOIDED', 'this invoice is already voided');
        const original = { seq: orig.seq, type: 'INVOICE', number: pad('INVOICE', orig.doc_no), seriesReset: orig.series_reset };

        if (i.type === 'VOID') {
          if (prior.length) throw new CoreError('PARTLY_REVERSED', 'this invoice already has refunds or returns; it cannot be voided');
          if (orig.seq <= (lastZ()?.seq ?? 0)) throw new CoreError('AFTER_Z', 'this invoice is from a closed day; use a refund or return');
          const net = new Map<string, number>();
          for (const p of ob.payments) net.set(p.method, (net.get(p.method) ?? 0) + p.amount);
          if (ob.change) net.set('CASH', (net.get('CASH') ?? 0) - ob.change);
          const refunds = [...net].filter(([, v]) => v > 0).map(([method, amount]) => ({ method, amount }));
          const body = { kind: 'VOID', original, reason: i.reason, approvedBy: i.approvedBy ?? null, vatMode: ob.vatMode, vatRateBp: ob.vatRateBp, lines: ob.lines, totals: ob.totals, refunds };
          return append(at, 'VOID', i.userId, i.online, body, orig);
        }

        if (!i.lines?.length) throw new CoreError('LINES_REQUIRED', 'choose the lines and quantities to reverse');
        type Done = { qty: number; gross: number; vatEx: number; byType: Record<string, number> };
        const done = new Map<number, Done>();
        const doneFor = (n: number) => done.get(n) ?? { qty: 0, gross: 0, vatEx: 0, byType: {} };
        for (const p of prior) {
          for (const l of (JSON.parse(p.body) as { lines: PricedLine[] }).lines) {
            const d = doneFor(l.lineNo);
            const byType = { ...d.byType };
            for (const [k, v] of Object.entries(l.discountsByType ?? {})) byType[k] = (byType[k] ?? 0) + v;
            done.set(l.lineNo, { qty: d.qty + l.qtyMilli, gross: d.gross + l.gross, vatEx: d.vatEx + (l.vatExemption ?? 0), byType });
          }
        }
        const netByClass: Partial<Record<VatClass, number>> = {};
        const tot = { gross: 0, discount: 0, vatExemption: 0, discounts: {} as Record<string, number> };
        const lines = i.lines.map((r) => {
          const ol = ob.lines.find((l) => l.lineNo === r.lineNo);
          if (!ol) throw new CoreError('BAD_LINE', `invoice has no line ${r.lineNo}`);
          if (!Number.isSafeInteger(r.qtyMilli) || r.qtyMilli <= 0) throw new CoreError('BAD_LINE', 'quantity must be positive');
          const d = doneFor(r.lineNo);
          const qty = d.qty + r.qtyMilli;
          if (qty > ol.qtyMilli) throw new CoreError('QTY_EXCEEDS', `line ${r.lineNo}: more than was sold is being reversed`);
          // Cumulative proportions so the last reversal lands exactly on the original amounts.
          const share = (total: number, already: number) => mulDiv(total, qty, ol.qtyMilli) - already;
          const g = share(ol.gross, d.gross);
          let vx = share(ol.vatExemption ?? 0, d.vatEx);
          const byType: Record<string, number> = {};
          for (const [k, v] of Object.entries(ol.discountsByType ?? {})) byType[k] = share(v, d.byType[k] ?? 0);
          let disc = Object.values(byType).reduce((a, v) => a + v, 0);
          // ponytail: rounding can leave a part 1 centavo negative; take it off the VAT exemption, then the discount.
          let over = disc + vx - g;
          if (over > 0) {
            const fromVx = Math.min(over, vx);
            vx -= fromVx;
            over -= fromVx;
            for (const k of Object.keys(byType)) {
              const cut = Math.min(over, byType[k]);
              byType[k] -= cut;
              over -= cut;
            }
            disc = Object.values(byType).reduce((a, v) => a + v, 0);
          }
          const net = g - disc - vx;
          const classes = apportion(net, ol.netByClass ?? { [ol.vatClass]: ol.net }) as Partial<Record<VatClass, number>>;
          done.set(r.lineNo, { qty, gross: d.gross + g, vatEx: d.vatEx + vx, byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, (d.byType[k] ?? 0) + v])) });
          tot.gross += g;
          tot.discount += disc;
          tot.vatExemption += vx;
          for (const [k, v] of Object.entries(byType)) if (v) tot.discounts[k] = (tot.discounts[k] ?? 0) + v;
          for (const [k, v] of Object.entries(classes)) netByClass[k as VatClass] = (netByClass[k as VatClass] ?? 0) + (v ?? 0);
          return {
            lineNo: ol.lineNo, description: ol.description, qtyMilli: r.qtyMilli, unitPrice: ol.unitPrice, vatClass: ol.vatClass,
            gross: g, discount: disc, discountsByType: byType, vatExemption: vx, net, netByClass: classes,
          };
        });
        const totals: Totals = { ...tot, net: tot.gross - tot.discount - tot.vatExemption, ...splitByClass(netByClass, ob.vatMode, ob.vatRateBp) };
        const refunds = [{ method: i.refundMethod ?? 'CASH', amount: totals.net }];
        const body = { kind: i.type, original, reason: i.reason, approvedBy: i.approvedBy ?? null, vatMode: ob.vatMode, vatRateBp: ob.vatRateBp, lines, totals, refunds };
        return append(at, i.type, i.userId, i.online, body, orig);
      });
    },

    /** Order slips, acknowledgment and collection receipts: own series, always with the input-tax footer. */
    issueSupplementary(i: SupplementaryInput): Posted {
      return audited(i.userId, `ISSUE_${i.type}`, () => {
        const at = now();
        if (!SUPPLEMENTARY_TYPES.includes(i.type)) throw new CoreError('BAD_DOCUMENT', 'unknown supplementary document');
        const base = { kind: i.type, party: cleanBuyer(i.party), reference: i.reference?.trim() || null, memo: i.memo?.trim() || null };
        if (i.type === 'ORDER') {
          if (!i.lines?.length) throw new CoreError('BAD_DOCUMENT', 'an order slip needs items');
          const lines = i.lines.map((l, n) => {
            if (!l.description || !Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0 || !isCentavos(l.unitPrice)) throw new CoreError('BAD_DOCUMENT', `line ${n + 1} is incomplete`);
            return { lineNo: n + 1, description: l.description, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, gross: mulDiv(l.qtyMilli, l.unitPrice, 1000) };
          });
          return append(at, 'ORDER', i.userId, i.online, { ...base, lines, total: lines.reduce((a, l) => a + l.gross, 0) });
        }
        if (!isCentavos(i.amount) || i.amount === 0) throw new CoreError('BAD_DOCUMENT', 'enter the amount received');
        const payments = (i.payments ?? []).map((p) => ({ method: p.method, amount: p.amount, ref: p.ref ?? null }));
        return append(at, i.type, i.userId, i.online, { ...base, amount: i.amount, payments });
      });
    },

    cancelSupplementary(userId: string, online: boolean, seq: number, reason: string): Posted {
      return audited(userId, 'ISSUE_CANCEL', () => {
        const at = now();
        if (!reason?.trim()) throw new CoreError('REASON_REQUIRED', 'give a reason');
        const orig = entry(seq);
        if (!orig || !SUPPLEMENTARY_TYPES.includes(orig.doc_type)) throw new CoreError('BAD_DOCUMENT', 'only order slips and acknowledgment or collection receipts can be cancelled');
        if (db.get(`SELECT 1 FROM ledger_entry WHERE reverses_seq = ?`, seq)) throw new CoreError('ALREADY_CANCELLED', 'this document is already cancelled');
        const body = { kind: 'CANCEL', original: { seq, type: orig.doc_type, number: pad(orig.doc_type, orig.doc_no) }, reason: reason.trim() };
        return append(at, 'CANCEL', userId, online, body, orig);
      });
    },

    /** Record a hand-written invoice from the client's BIR-registered booklet (outage, or buyer details the system can't take). */
    recordManualInvoice(i: ManualInvoiceInput): Posted {
      return audited(i.userId, 'RECORD_MANUAL', () => {
        const at = now();
        requireSeller();
        if (!i.manualNo?.trim()) throw new CoreError('BAD_DOCUMENT', 'enter the manual invoice number');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(i.issuedOn ?? '')) throw new CoreError('BAD_DOCUMENT', 'manual invoice date must be YYYY-MM-DD');
        if (!i.reason?.trim()) throw new CoreError('REASON_REQUIRED', 'give a reason');
        const dup = db.get(`SELECT 1 FROM ledger_entry WHERE doc_type = 'MANUAL' AND json_extract(body, '$.manualNo') = ?`, i.manualNo.trim());
        if (dup) throw new CoreError('DUPLICATE', `manual invoice ${i.manualNo} is already recorded`);
        let linkedNumber: string | null = null;
        if (i.linkedInvoiceSeq != null) {
          const inv = entry(i.linkedInvoiceSeq);
          if (!inv || inv.doc_type !== 'INVOICE') throw new CoreError('NOT_AN_INVOICE', 'a manual invoice can only stand in for a system invoice');
          linkedNumber = pad('INVOICE', inv.doc_no);
        }
        const p = priceFor(at, i.lines);
        const body = {
          kind: 'MANUAL', manualNo: i.manualNo.trim(), issuedOn: i.issuedOn, reason: i.reason.trim(), buyer: cleanBuyer(i.buyer),
          linkedSeq: i.linkedInvoiceSeq ?? null, linkedNumber, vatMode: p.vatMode, vatRateBp: p.vatRateBp, lines: p.lines, totals: p.totals,
        };
        return append(at, 'MANUAL', i.userId, i.online, body);
      });
    },

    /** Read-only: the current day so far, as an X reading would show it, without issuing one. */
    peekReading(): Reading {
      const z = lastZ();
      const prev = z ? (JSON.parse(z.body) as Reading) : null;
      const rows = db.all<EntryRow>(`SELECT * FROM ledger_entry WHERE seq > ? ORDER BY seq`, z?.seq ?? 0);
      const a = accumulators();
      return summarize('X', rows, { fromSeq: (z?.seq ?? 0) + 1, grandTotal: prev?.endGrandTotal ?? 0, resetCounter: prev?.endResetCounter ?? 0 }, { grandTotal: a.grand_total, resetCounter: a.reset_counter, zCounter: a.z_counter });
    },

    /** Read-only: issued documents, newest first, for the journal screen. */
    documents(o: { before?: number; limit?: number; type?: string; search?: string } = {}) {
      const rows = db.all<EntryRow>(
        `SELECT * FROM ledger_entry WHERE seq < ? AND (? IS NULL OR doc_type = ?) ORDER BY seq DESC LIMIT ?`,
        o.before ?? Number.MAX_SAFE_INTEGER, o.type ?? null, o.type ?? null, Math.min(o.limit ?? 50, 200),
      );
      return rows
        .map((r) => {
          const b = JSON.parse(r.body);
          return {
            seq: r.seq, docType: r.doc_type, number: pad(r.doc_type, r.doc_no), resetCounter: r.series_reset, issuedAt: r.issued_at, userId: r.user_id,
            offline: r.created_offline === 1, amount: (b.totals?.net ?? b.total ?? b.amount ?? b.netSales ?? null) as number | null,
            reversesSeq: r.reverses_seq, reversed: !!db.get(`SELECT 1 FROM ledger_entry WHERE reverses_seq = ?`, r.seq),
            sameDay: r.seq > (lastZ()?.seq ?? 0),
          };
        })
        .filter((d) => !o.search || d.number.includes(o.search));
    },

    /** Read-only: one document's e-journal text and the parts the UI needs for corrections. */
    document(seq: number) {
      const e = entry(seq);
      const j = db.get<{ text: string }>(`SELECT text FROM journal WHERE seq = ?`, seq);
      if (!e || !j) throw new CoreError('NOT_FOUND', 'no document with that number');
      const b = JSON.parse(e.body);
      return { seq, docType: e.doc_type, number: pad(e.doc_type, e.doc_no), text: j.text, lines: (b.lines ?? []) as { lineNo: number; description: string; qtyMilli: number }[] };
    },

    xReading: (userId: string, online = true) => reading('X', userId, online),
    zReading: (userId: string, online = true) => reading('Z', userId, online),

    /**
     * Print a document. The first print is the original; every later one is marked REPRINT #n.
     * Every print is logged. Output is rebuilt from the blocks stored when the document was issued.
     */
    print(userId: string, seq: number, format: 'text' | 'escpos' | 'html' = 'text') {
      return audited(userId, 'PRINT', () => {
        const e = entry(seq);
        const j = db.get<{ blocks: string | null }>(`SELECT blocks FROM journal WHERE seq = ?`, seq);
        if (!e || !j?.blocks) throw new CoreError('NOT_FOUND', 'no printable document with that number');
        const copyNo = db.get<{ n: number }>(`SELECT count(*) AS n FROM print_log WHERE seq = ?`, seq)!.n;
        const at = now();
        let blocks = JSON.parse(j.blocks) as Block[];
        if (copyNo > 0) blocks = withReprintBanner(blocks, copyNo, localTime(at.toISOString(), tzMinutes), userId);
        db.run(`INSERT INTO print_log (seq, copy_no, at, user_id) VALUES (?,?,?,?)`, seq, copyNo, at.toISOString(), userId);
        const number = pad(e.doc_type, e.doc_no);
        log(userId, copyNo ? 'REPRINT' : 'PRINT', `${e.doc_type} ${number}`, null, { seq, copyNo, format });
        const paper = mustTerminal().paper;
        const output =
          format === 'html' ? renderHtml(blocks, `${e.doc_type} ${number}`) : format === 'escpos' ? renderEscPos(blocks, COLUMNS[paper === 'A4' ? '80' : paper]) : renderText(blocks, COLUMNS[paper]);
        return { copyNo, reprint: copyNo > 0, output };
      });
    },

    /** Full integrity check. Also run on open and before every Z reading. */
    verify: (userId = 'system') => check(userId),

    /** A supervisor has reviewed the listed problems. Issuing resumes; the problems stay on record. */
    acknowledgeIntegrity(userId: string, note: string) {
      if (!note?.trim()) throw new CoreError('REASON_REQUIRED', 'record what was found and done');
      const open = verifyAll(db).filter((i) => !ackedFingerprints().has(fingerprint(i)));
      tx(() => log(userId, 'INTEGRITY_ACK', null, null, { fingerprints: open.map(fingerprint), note }));
      return check(userId);
    },

    /** Human-readable e-journal for a ledger range. Logged as an export. */
    exportJournal(userId: string, fromSeq = 1, toSeq = Number.MAX_SAFE_INTEGER): string {
      return tx(() => {
        const rows = db.all<{ text: string }>(`SELECT text FROM journal WHERE seq BETWEEN ? AND ? ORDER BY seq`, fromSeq, toSeq);
        log(userId, 'EXPORT', 'journal', null, { fromSeq, toSeq, documents: rows.length });
        return rows.map((r) => r.text).join('\n\n');
      });
    },

    /** The hub acknowledged everything up to seq. Phase 3 sync calls this. */
    markSynced(userId: string, upToSeq: number) {
      tx(() => {
        db.run(`UPDATE outbox SET acked_at = ? WHERE seq <= ? AND acked_at IS NULL`, now().toISOString(), upToSeq);
        log(userId, 'TRANSMIT_ACK', 'hub', null, { upToSeq });
      });
    },

    /** App-level events the core can't see by itself: LOGIN, LOGOUT, PERMISSION_CHANGE, EDIT_ATTEMPT... */
    record(userId: string, action: string, object: string | null = null, before: unknown = null, after: unknown = null) {
      tx(() => log(userId, action, object, before, after));
    },

    state() {
      return {
        terminal: terminal() ?? null, seller: setting<Seller>('seller'), supplier: setting<Supplier>('supplier'),
        accumulators: accumulators(), locked, issues: lastIssues, coreVersion: CORE_VERSION,
      };
    },

    highWater(): HighWater | null {
      const t = terminal();
      if (!t) return null;
      const a = accumulators();
      const last = db.get<{ seq: number }>(`SELECT max(seq) AS seq FROM ledger_entry`);
      return { terminalId: t.terminal_id, seq: last?.seq ?? 0, resetCounter: a.reset_counter, grandTotal: a.grand_total, zCounter: a.z_counter };
    },
  };
}

export type Core = ReturnType<typeof openCore>;

/** Refuse a restore that would move numbering or totals backwards from anything already seen. */
export function checkRestore(current: HighWater | null, candidate: HighWater | null): void {
  if (!candidate) throw new CoreError('RESTORE_BAD_FILE', 'backup has no terminal');
  if (!current) return;
  if (current.terminalId !== candidate.terminalId) throw new CoreError('RESTORE_WRONG_TERMINAL', 'backup belongs to a different terminal');
  const behind =
    candidate.seq < current.seq ||
    candidate.zCounter < current.zCounter ||
    candidate.resetCounter < current.resetCounter ||
    (candidate.resetCounter === current.resetCounter && candidate.grandTotal < current.grandTotal);
  if (behind) throw new CoreError('RESTORE_REWINDS', 'backup is older than data already issued; restoring it would rewind numbering');
}
