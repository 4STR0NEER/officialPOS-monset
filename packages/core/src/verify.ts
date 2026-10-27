import type { Db } from './port.ts';
import { canonical, GENESIS_HASH, GRAND_TOTAL_MAX, sha256hex } from './util.ts';

export interface EntryRow {
  seq: number;
  doc_type: string;
  doc_no: number;
  series_reset: number;
  reverses_seq: number | null;
  issued_at: string;
  business_date: string;
  created_offline: number;
  device_id: string;
  user_id: string;
  core_version: string;
  body: string;
  prev_hash: string;
  hash: string;
}

export interface ActivityRow {
  id: number;
  at: string;
  user_id: string;
  device_id: string;
  action: string;
  object: string | null;
  before_json: string | null;
  after_json: string | null;
  prev_hash: string;
  hash: string;
}

export interface Issue {
  kind: 'SEQ_GAP' | 'CHAIN' | 'HASH' | 'NUMBER_GAP' | 'BAD_REVERSAL' | 'JOURNAL_MISSING' | 'ACCUMULATOR' | 'SERIES' | 'ACTIVITY';
  seq?: number;
  detail: string;
}

export const REVERSALS = new Set(['VOID', 'REFUND', 'RETURN']);
/** What each correcting document may point at. */
export const REVERSAL_TARGETS: Record<string, string[]> = {
  VOID: ['INVOICE'], REFUND: ['INVOICE'], RETURN: ['INVOICE'], CANCEL: ['ORDER', 'ACK', 'COLLECTION'],
};

export function hashEntry(r: Omit<EntryRow, 'hash'> & { hash?: string }): string {
  const { body, prev_hash, hash: _h, ...header } = r;
  return sha256hex(`${prev_hash}\n${canonical(header)}\n${body}`);
}

export function hashActivity(r: Omit<ActivityRow, 'hash'> & { hash?: string }): string {
  const { prev_hash, hash: _h, ...rest } = r;
  return sha256hex(`${prev_hash}\n${canonical(rest)}`);
}

export function addGrandTotal(gt: number, reset: number, amount: number): { gt: number; reset: number } {
  let n = gt + amount;
  let r = reset;
  while (n > GRAND_TOTAL_MAX) {
    n -= GRAND_TOTAL_MAX + 1;
    r += 1;
  }
  return { gt: n, reset: r };
}

/** Next number after (no, reset) in a series of the given width. */
export function nextNumber(no: number, reset: number, width: number): { no: number; reset: number } {
  return no >= 10 ** width - 1 ? { no: 1, reset: reset + 1 } : { no: no + 1, reset };
}

export interface Accumulators {
  grand_total: number;
  reset_counter: number;
  z_counter: number;
  void_count: number;
  void_total: number;
  refund_count: number;
  refund_total: number;
  return_count: number;
  return_total: number;
}

/** Fold one ledger entry into the running totals. Used when posting and when re-checking. */
export function applyEntry(a: Accumulators, docType: string, body: { totals?: { gross: number; net: number } }): Accumulators {
  const n = { ...a };
  if (docType === 'INVOICE') {
    const g = addGrandTotal(n.grand_total, n.reset_counter, body.totals!.gross);
    n.grand_total = g.gt;
    n.reset_counter = g.reset;
  } else if (docType === 'VOID') {
    n.void_count += 1;
    n.void_total += body.totals!.net;
  } else if (docType === 'REFUND') {
    n.refund_count += 1;
    n.refund_total += body.totals!.net;
  } else if (docType === 'RETURN') {
    n.return_count += 1;
    n.return_total += body.totals!.net;
  } else if (docType === 'Z') {
    n.z_counter += 1;
  }
  return n;
}

export const ZERO_ACC: Accumulators = {
  grand_total: 0, reset_counter: 0, z_counter: 0, void_count: 0, void_total: 0, refund_count: 0, refund_total: 0, return_count: 0, return_total: 0,
};

const PAGE = 5000;

/**
 * Full integrity check: hash chain, gapless seq and document numbers, reversal links,
 * journal coverage, accumulators recomputed from the ledger, activity-log chain.
 */
// ponytail: walks the whole ledger every time; add signed checkpoints if boot gets slow (~1M rows).
export function verifyAll(db: Db): Issue[] {
  // One read transaction = one consistent snapshot, even while another process is posting.
  db.exec('BEGIN');
  try {
    return verifySnapshot(db);
  } finally {
    db.exec('ROLLBACK');
  }
}

function verifySnapshot(db: Db): Issue[] {
  const issues: Issue[] = [];
  const widths = new Map(db.all<{ doc_type: string; width: number; next_no: number; reset_counter: number }>(`SELECT * FROM doc_series`).map((s) => [s.doc_type, s]));
  const last = new Map<string, { no: number; reset: number }>();
  const types = new Map<number, string>();
  let acc = { ...ZERO_ACC };
  let prevHash = GENESIS_HASH;
  let expectSeq = 1;

  for (let after = 0; ; ) {
    const rows = db.all<EntryRow & { has_journal: number }>(
      `SELECT e.*, (j.seq IS NOT NULL) AS has_journal FROM ledger_entry e LEFT JOIN journal j ON j.seq = e.seq
       WHERE e.seq > ? ORDER BY e.seq LIMIT ?`,
      after,
      PAGE,
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      const { has_journal, ...row } = r;
      if (row.seq !== expectSeq) issues.push({ kind: 'SEQ_GAP', seq: row.seq, detail: `expected seq ${expectSeq}` });
      if (row.prev_hash !== prevHash) issues.push({ kind: 'CHAIN', seq: row.seq, detail: 'prev_hash does not match the previous entry' });
      if (hashEntry(row) !== row.hash) issues.push({ kind: 'HASH', seq: row.seq, detail: 'entry content does not match its hash' });
      if (!has_journal) issues.push({ kind: 'JOURNAL_MISSING', seq: row.seq, detail: 'no e-journal text' });

      const width = widths.get(row.doc_type)?.width ?? 6;
      const prev = last.get(row.doc_type);
      const want = prev ? nextNumber(prev.no, prev.reset, width) : { no: 1, reset: 0 };
      if (row.doc_no !== want.no || row.series_reset !== want.reset) {
        issues.push({ kind: 'NUMBER_GAP', seq: row.seq, detail: `${row.doc_type} ${row.series_reset}/${row.doc_no}, expected ${want.reset}/${want.no}` });
      }
      last.set(row.doc_type, { no: row.doc_no, reset: row.series_reset });

      const allowed = REVERSAL_TARGETS[row.doc_type];
      if (allowed) {
        const target = row.reverses_seq == null ? undefined : types.get(row.reverses_seq);
        if (!target || !allowed.includes(target)) issues.push({ kind: 'BAD_REVERSAL', seq: row.seq, detail: `reverses ${row.reverses_seq ?? 'nothing'}` });
      } else if (row.reverses_seq != null) {
        issues.push({ kind: 'BAD_REVERSAL', seq: row.seq, detail: `${row.doc_type} cannot reverse` });
      }
      types.set(row.seq, row.doc_type);

      try {
        acc = applyEntry(acc, row.doc_type, JSON.parse(row.body));
      } catch {
        issues.push({ kind: 'HASH', seq: row.seq, detail: 'body is not readable' });
      }
      prevHash = row.hash;
      expectSeq = row.seq + 1;
      after = row.seq;
    }
  }

  const stored = db.get<Accumulators>(`SELECT grand_total, reset_counter, z_counter, void_count, void_total, refund_count, refund_total, return_count, return_total FROM accumulator WHERE id=1`);
  for (const k of Object.keys(ZERO_ACC) as (keyof Accumulators)[]) {
    // Detail is the difference, not the values, so an acknowledged mismatch stays recognisable as sales continue.
    if (!stored || stored[k] !== acc[k]) issues.push({ kind: 'ACCUMULATOR', detail: `${k} differs from the ledger by ${(stored?.[k] ?? 0) - acc[k]}` });
  }

  for (const [type, s] of widths) {
    const prev = last.get(type);
    const want = prev ? nextNumber(prev.no, prev.reset, s.width) : { no: 1, reset: 0 };
    if (s.next_no !== want.no || s.reset_counter !== want.reset) {
      issues.push({ kind: 'SERIES', detail: `${type} series at ${s.reset_counter}/${s.next_no}, ledger says ${want.reset}/${want.no}` });
    }
  }

  let aPrev = GENESIS_HASH;
  for (let after = 0; ; ) {
    const rows = db.all<ActivityRow>(`SELECT * FROM activity_log WHERE id > ? ORDER BY id LIMIT ?`, after, PAGE);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.prev_hash !== aPrev || hashActivity(r) !== r.hash) issues.push({ kind: 'ACTIVITY', detail: `activity log row ${r.id} altered` });
      aPrev = r.hash;
      after = r.id;
    }
  }
  return issues;
}

export const fingerprint = (i: Issue): string => `${i.kind}|${i.seq ?? ''}|${i.detail}`;
