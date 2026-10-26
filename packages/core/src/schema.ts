import type { Db } from './port.ts';

export const SCHEMA_VERSION = 1;

export const DOC_TYPES = ['INVOICE', 'VOID', 'REFUND', 'RETURN', 'CANCEL', 'ORDER', 'ACK', 'COLLECTION', 'X', 'Z'] as const;
export type DocType = (typeof DOC_TYPES)[number];

const appendOnly = (t: string) => `
CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;
CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;`;

const V1 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE terminal (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  terminal_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('LIVE','DEMO','NON_INVOICING')),
  vat_mode TEXT NOT NULL CHECK (vat_mode IN ('VAT','NONVAT','EXEMPT')),
  min TEXT, serial TEXT, sln TEXT, ptu_no TEXT, ptu_date TEXT,
  created_at TEXT NOT NULL
);
CREATE TRIGGER terminal_identity_fixed BEFORE UPDATE ON terminal
WHEN NEW.mode IS NOT OLD.mode OR NEW.terminal_id IS NOT OLD.terminal_id OR NEW.device_id IS NOT OLD.device_id
BEGIN SELECT RAISE(ABORT, 'terminal mode and identity are fixed for the life of the install'); END;
CREATE TRIGGER terminal_no_delete BEFORE DELETE ON terminal BEGIN SELECT RAISE(ABORT, 'terminal cannot be deleted'); END;

CREATE TABLE doc_series (
  doc_type TEXT PRIMARY KEY,
  next_no INTEGER NOT NULL CHECK (next_no >= 1),
  width INTEGER NOT NULL CHECK (width >= 6),
  reset_counter INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER doc_series_forward_only BEFORE UPDATE ON doc_series
WHEN NEW.reset_counter < OLD.reset_counter
  OR (NEW.reset_counter = OLD.reset_counter AND NEW.next_no < OLD.next_no)
BEGIN SELECT RAISE(ABORT, 'document series can only move forward'); END;
CREATE TRIGGER doc_series_no_delete BEFORE DELETE ON doc_series BEGIN SELECT RAISE(ABORT, 'document series cannot be deleted'); END;

CREATE TABLE ledger_entry (
  seq INTEGER PRIMARY KEY,
  doc_type TEXT NOT NULL,
  doc_no INTEGER NOT NULL,
  series_reset INTEGER NOT NULL,
  reverses_seq INTEGER REFERENCES ledger_entry(seq),
  issued_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  created_offline INTEGER NOT NULL CHECK (created_offline IN (0,1)),
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  core_version TEXT NOT NULL,
  body TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  UNIQUE (doc_type, series_reset, doc_no)
);
CREATE INDEX ledger_reverses ON ledger_entry(reverses_seq);
${appendOnly('ledger_entry')}

CREATE TABLE journal (
  seq INTEGER PRIMARY KEY REFERENCES ledger_entry(seq),
  layout_version TEXT NOT NULL,
  text TEXT NOT NULL
);
${appendOnly('journal')}

-- Running totals. Derived from the ledger and re-checked by verify(); triggers stop them going backwards.
CREATE TABLE accumulator (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  grand_total INTEGER NOT NULL DEFAULT 0,
  reset_counter INTEGER NOT NULL DEFAULT 0,
  z_counter INTEGER NOT NULL DEFAULT 0,
  void_count INTEGER NOT NULL DEFAULT 0, void_total INTEGER NOT NULL DEFAULT 0,
  refund_count INTEGER NOT NULL DEFAULT 0, refund_total INTEGER NOT NULL DEFAULT 0,
  return_count INTEGER NOT NULL DEFAULT 0, return_total INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER accumulator_forward_only BEFORE UPDATE ON accumulator
WHEN NEW.reset_counter < OLD.reset_counter OR NEW.z_counter < OLD.z_counter
  OR (NEW.reset_counter = OLD.reset_counter AND NEW.grand_total < OLD.grand_total)
  OR NEW.void_count < OLD.void_count OR NEW.void_total < OLD.void_total
  OR NEW.refund_count < OLD.refund_count OR NEW.refund_total < OLD.refund_total
  OR NEW.return_count < OLD.return_count OR NEW.return_total < OLD.return_total
BEGIN SELECT RAISE(ABORT, 'accumulators can never decrease'); END;
CREATE TRIGGER accumulator_no_delete BEFORE DELETE ON accumulator BEGIN SELECT RAISE(ABORT, 'accumulator cannot be deleted'); END;

CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  action TEXT NOT NULL,
  object TEXT,
  before_json TEXT,
  after_json TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
${appendOnly('activity_log')}

-- Rules that change over time. New rows supersede old ones by effective_from; nothing is edited.
CREATE TABLE rule_set (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  payload TEXT NOT NULL,
  source_ref TEXT NOT NULL
);
${appendOnly('rule_set')}

-- Replication bookkeeping (terminal -> hub). Kept off the hashed ledger row so acking a sync is not an edit.
CREATE TABLE outbox (
  seq INTEGER PRIMARY KEY REFERENCES ledger_entry(seq),
  acked_at TEXT
);

INSERT INTO accumulator (id) VALUES (1);
INSERT INTO rule_set (kind, effective_from, payload, source_ref)
VALUES ('VAT_RATE', '2006-02-01', '{"rateBp":1200}', 'RA 9337 (12% VAT) - verify current rate');
${DOC_TYPES.map((t) => `INSERT INTO doc_series (doc_type, next_no, width) VALUES ('${t}', 1, ${t === 'X' || t === 'Z' ? 6 : 8});`).join('\n')}
`;

export function migrate(db: Db): void {
  const hasMeta = db.get(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'`);
  const version = hasMeta ? Number(db.get<{ value: string }>(`SELECT value FROM meta WHERE key='schema_version'`)?.value ?? 0) : 0;
  if (version > SCHEMA_VERSION) throw new Error(`database schema v${version} is newer than this core (v${SCHEMA_VERSION})`);
  if (version === SCHEMA_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(V1);
    db.run(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`, String(SCHEMA_VERSION));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
