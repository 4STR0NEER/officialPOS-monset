import type { Db, Param } from './port.ts';
import { migrate, type DocType } from './schema.ts';
import { canonical, CoreError, GENESIS_HASH, mulDiv } from './util.ts';
import { priceSale, settle, splitByClass, type Payment, type PricedLine, type SaleLine, type VatClass, type VatMode } from './totals.ts';
import { applyEntry, fingerprint, hashActivity, hashEntry, nextNumber, verifyAll, type Accumulators, type EntryRow, type Issue } from './verify.ts';
import { summarize, type Reading } from './readings.ts';
import { LAYOUT_VERSION, renderPlain } from './journal.ts';

/** The accredited compliance-core version. Printed on every document. Must equal packages/core/package.json. */
export const CORE_VERSION = '0.1.0';

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
}

export type TerminalPatch = Partial<Pick<TerminalInit, 'min' | 'serial' | 'sln' | 'ptuNo' | 'ptuDate' | 'vatMode'>>;

export interface Buyer {
  name?: string;
  address?: string;
  tin?: string;
  businessStyle?: string;
}

export interface SaleInput {
  userId: string;
  online: boolean; // could this device reach the hub when the sale was made
  lines: SaleLine[];
  payments: Payment[];
  buyer?: Buyer;
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

export interface Posted {
  seq: number;
  docType: DocType;
  docNo: number;
  number: string;
  resetCounter: number;
  issuedAt: string;
  offline: boolean;
  hash: string;
  text: string;
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

export function openCore(db: Db, opts: CoreOptions = {}) {
  migrate(db);
  const now = opts.now ?? (() => new Date());
  const tzMs = (opts.tzOffsetMinutes ?? 480) * 60_000;
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
  const businessDate = (at: Date) => new Date(at.getTime() + tzMs).toISOString().slice(0, 10);
  const series = (t: string) => db.get<{ next_no: number; width: number; reset_counter: number }>(`SELECT * FROM doc_series WHERE doc_type = ?`, t)!;
  const pad = (t: string, no: number) => String(no).padStart(series(t).width, '0');
  const lastZ = () => db.get<EntryRow>(`SELECT * FROM ledger_entry WHERE doc_type = 'Z' ORDER BY seq DESC LIMIT 1`);

  function tx<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
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

  function rule<T>(kind: string, date: string): T {
    const r = db.get<{ payload: string }>(
      `SELECT payload FROM rule_set WHERE kind = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1`, kind, date,
    );
    if (!r) throw new CoreError('NO_RULE', `no ${kind} rule in effect on ${date}`);
    return JSON.parse(r.payload) as T;
  }

  /** The one way anything enters the ledger. Number, hash, totals, journal and outbox move together or not at all. */
  function append(at: Date, docType: DocType, userId: string, online: boolean, body: object, reverses?: EntryRow): Posted {
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

    const row: Omit<EntryRow, 'hash'> = {
      seq: (last?.seq ?? 0) + 1,
      doc_type: docType,
      doc_no: s.next_no,
      series_reset: s.reset_counter,
      reverses_seq: reverses?.seq ?? null,
      issued_at: at.toISOString(),
      business_date: businessDate(at),
      created_offline: online ? 0 : 1,
      device_id: t.device_id,
      user_id: userId,
      core_version: CORE_VERSION,
      body: canonical(body),
      prev_hash: last?.hash ?? GENESIS_HASH,
    };
    const hash = hashEntry(row);
    db.run(
      `INSERT INTO ledger_entry (seq, doc_type, doc_no, series_reset, reverses_seq, issued_at, business_date, created_offline, device_id, user_id, core_version, body, prev_hash, hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      row.seq, row.doc_type, row.doc_no, row.series_reset, row.reverses_seq, row.issued_at, row.business_date,
      row.created_offline, row.device_id, row.user_id, row.core_version, row.body, row.prev_hash, hash,
    );

    const a = applyEntry(accumulators(), docType, body as { totals?: { gross: number; net: number } });
    db.run(
      `UPDATE accumulator SET ${ACC_COLS.split(', ').map((c) => `${c} = ?`).join(', ')} WHERE id = 1`,
      ...(ACC_COLS.split(', ').map((c) => a[c as keyof Accumulators]) as Param[]),
    );

    const number = pad(docType, row.doc_no);
    const text = renderPlain(
      {
        coreVersion: CORE_VERSION, docType, number, resetCounter: row.series_reset, issuedAt: row.issued_at, businessDate: row.business_date,
        terminal: t, offline: !online, reverses: reverses ? `${reverses.doc_type} ${pad(reverses.doc_type, reverses.doc_no)}` : undefined,
      },
      body,
    );
    db.run(`INSERT INTO journal (seq, layout_version, text) VALUES (?, ?, ?)`, row.seq, LAYOUT_VERSION, text);
    db.run(`INSERT INTO outbox (seq) VALUES (?)`, row.seq);
    log(userId, 'ISSUE', `${docType} ${number}`, null, { seq: row.seq, hash });

    return { seq: row.seq, docType, docNo: row.doc_no, number, resetCounter: row.series_reset, issuedAt: row.issued_at, offline: !online, hash, text };
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
      return { posted: append(at, kind, userId, online, r), reading: r };
    });
  }

  if (terminal()) check();

  return {
    coreVersion: CORE_VERSION,

    initTerminal(userId: string, init: TerminalInit) {
      return audited(userId, 'TERMINAL_INIT', () => {
        if (terminal()) throw new CoreError('TERMINAL_EXISTS', 'this database already belongs to a terminal');
        if (!init.terminalId || !init.deviceId) throw new CoreError('BAD_TERMINAL', 'terminal and device IDs are required');
        if (!['LIVE', 'DEMO', 'NON_INVOICING'].includes(init.mode)) throw new CoreError('BAD_TERMINAL', 'unknown license mode');
        if (!['VAT', 'NONVAT', 'EXEMPT'].includes(init.vatMode)) throw new CoreError('BAD_TERMINAL', 'unknown VAT mode');
        db.run(
          `INSERT INTO terminal (id, terminal_id, device_id, mode, vat_mode, min, serial, sln, ptu_no, ptu_date, created_at) VALUES (1,?,?,?,?,?,?,?,?,?,?)`,
          init.terminalId, init.deviceId, init.mode, init.vatMode, init.min ?? null, init.serial ?? null, init.sln ?? null,
          init.ptuNo ?? null, init.ptuDate ?? null, now().toISOString(),
        );
        log(userId, 'TERMINAL_INIT', init.terminalId, null, init);
      });
    },

    /** Registration details arrive after install (MIN, PTU). Mode and identity can never change. */
    updateTerminal(userId: string, patch: TerminalPatch) {
      return audited(userId, 'SETTINGS_CHANGE', () => {
        const before = mustTerminal();
        const cols: Record<string, string> = { min: 'min', serial: 'serial', sln: 'sln', ptuNo: 'ptu_no', ptuDate: 'ptu_date', vatMode: 'vat_mode' };
        const keys = Object.keys(patch).filter((k) => k in cols) as (keyof TerminalPatch)[];
        if (keys.length !== Object.keys(patch).length) throw new CoreError('BAD_SETTING', 'only registration details and VAT mode can be changed');
        if (patch.vatMode && !['VAT', 'NONVAT', 'EXEMPT'].includes(patch.vatMode)) throw new CoreError('BAD_SETTING', 'unknown VAT mode');
        for (const k of keys) db.run(`UPDATE terminal SET ${cols[k]} = ? WHERE id = 1`, patch[k] ?? null);
        log(userId, 'SETTINGS_CHANGE', 'terminal', before, terminal());
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

    rule,

    postSale(i: SaleInput): Posted {
      return audited(i.userId, 'POST_SALE', () => {
        const at = now();
        const t = mustTerminal();
        const { rateBp } = rule<{ rateBp: number }>('VAT_RATE', businessDate(at));
        const { lines, totals } = priceSale(i.lines, t.vat_mode, rateBp);
        const { tendered, change } = settle(i.payments, totals.net);
        const body = {
          kind: 'INVOICE',
          vatMode: t.vat_mode,
          vatRateBp: rateBp,
          lines,
          totals,
          payments: i.payments.map((p) => ({ method: p.method, amount: p.amount, ref: p.ref ?? null })),
          tendered,
          change,
          buyer: i.buyer ?? null,
          terminal: { min: t.min, sln: t.sln, serial: t.serial, ptuNo: t.ptu_no, ptuDate: t.ptu_date },
        };
        return append(at, 'INVOICE', i.userId, i.online, body);
      });
    },

    /** Corrections are new documents that point at the original invoice. Nothing is ever edited. */
    postReversal(i: ReversalInput): Posted {
      return audited(i.userId, `POST_${i.type}`, () => {
        const at = now();
        if (!['VOID', 'REFUND', 'RETURN'].includes(i.type)) throw new CoreError('BAD_REVERSAL', 'unknown reversal type');
        if (!i.reason?.trim()) throw new CoreError('REASON_REQUIRED', 'give a reason');
        const orig = db.get<EntryRow>(`SELECT * FROM ledger_entry WHERE seq = ?`, i.invoiceSeq);
        if (!orig || orig.doc_type !== 'INVOICE') throw new CoreError('NOT_AN_INVOICE', 'only invoices can be voided, refunded or returned');
        const ob = JSON.parse(orig.body) as {
          vatMode: VatMode; vatRateBp: number; lines: PricedLine[]; totals: { gross: number; discount: number; net: number };
          payments: Payment[]; change: number;
        };
        const prior = db.all<EntryRow>(`SELECT * FROM ledger_entry WHERE reverses_seq = ? ORDER BY seq`, orig.seq);
        if (prior.some((p) => p.doc_type === 'VOID')) throw new CoreError('ALREADY_VOIDED', 'this invoice is already voided');
        const original = { seq: orig.seq, docNo: orig.doc_no, seriesReset: orig.series_reset };

        if (i.type === 'VOID') {
          if (prior.length) throw new CoreError('PARTLY_REVERSED', 'this invoice already has refunds or returns; it cannot be voided');
          if (orig.seq <= (lastZ()?.seq ?? 0)) throw new CoreError('AFTER_Z', 'this invoice is from a closed day; use a refund or return');
          const net = new Map<string, number>();
          for (const p of ob.payments) net.set(p.method, (net.get(p.method) ?? 0) + p.amount);
          if (ob.change) net.set('CASH', (net.get('CASH') ?? 0) - ob.change);
          const refunds = [...net].filter(([, v]) => v > 0).map(([method, amount]) => ({ method, amount }));
          const body = { kind: 'VOID', original, reason: i.reason, approvedBy: i.approvedBy ?? null, lines: ob.lines, totals: ob.totals, refunds };
          return append(at, 'VOID', i.userId, i.online, body, orig);
        }

        if (!i.lines?.length) throw new CoreError('LINES_REQUIRED', 'choose the lines and quantities to reverse');
        const done = new Map<number, { qty: number; gross: number; discount: number }>();
        for (const p of prior) {
          for (const l of (JSON.parse(p.body) as { lines: PricedLine[] }).lines) {
            const d = done.get(l.lineNo) ?? { qty: 0, gross: 0, discount: 0 };
            done.set(l.lineNo, { qty: d.qty + l.qtyMilli, gross: d.gross + l.gross, discount: d.discount + l.discount });
          }
        }
        const netByClass: Record<VatClass, number> = { VATABLE: 0, EXEMPT: 0, ZERO: 0 };
        let gross = 0;
        let discount = 0;
        const lines = i.lines.map((r) => {
          const ol = ob.lines.find((l) => l.lineNo === r.lineNo);
          if (!ol) throw new CoreError('BAD_LINE', `invoice has no line ${r.lineNo}`);
          if (!Number.isSafeInteger(r.qtyMilli) || r.qtyMilli <= 0) throw new CoreError('BAD_LINE', 'quantity must be positive');
          const d = done.get(r.lineNo) ?? { qty: 0, gross: 0, discount: 0 };
          const qty = d.qty + r.qtyMilli;
          if (qty > ol.qtyMilli) throw new CoreError('QTY_EXCEEDS', `line ${r.lineNo}: more than was sold is being reversed`);
          // Cumulative proportions so the final reversal lands exactly on the original amounts.
          const g = mulDiv(ol.gross, qty, ol.qtyMilli) - d.gross;
          // ponytail: clamp keeps each part non-negative; in rare rounding cases up to 1 centavo of discount stays unreversed.
          const disc = Math.min(mulDiv(ol.discount, qty, ol.qtyMilli) - d.discount, g);
          done.set(r.lineNo, { qty, gross: d.gross + g, discount: d.discount + disc });
          gross += g;
          discount += disc;
          netByClass[ol.vatClass] += g - disc;
          return { lineNo: ol.lineNo, description: ol.description, qtyMilli: r.qtyMilli, unitPrice: ol.unitPrice, vatClass: ol.vatClass, gross: g, discount: disc, net: g - disc };
        });
        const totals = { gross, discount, discounts: {}, net: gross - discount, ...splitByClass(netByClass, ob.vatMode, ob.vatRateBp) };
        const refunds = [{ method: i.refundMethod ?? 'CASH', amount: totals.net }];
        const body = { kind: i.type, original, reason: i.reason, approvedBy: i.approvedBy ?? null, lines, totals, refunds };
        return append(at, i.type, i.userId, i.online, body, orig);
      });
    },

    xReading: (userId: string, online = true) => reading('X', userId, online),
    zReading: (userId: string, online = true) => reading('Z', userId, online),

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

    /** App-level events the core can't see by itself: LOGIN, LOGOUT, PRINT, PERMISSION_CHANGE, EDIT_ATTEMPT... */
    record(userId: string, action: string, object: string | null = null, before: unknown = null, after: unknown = null) {
      tx(() => log(userId, action, object, before, after));
    },

    state() {
      return { terminal: terminal() ?? null, accumulators: accumulators(), locked, issues: lastIssues, coreVersion: CORE_VERSION };
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
