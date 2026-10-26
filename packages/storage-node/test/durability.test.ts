import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CoreError, openCore } from '@monset/core';
import { backup, openNodeDb, restore } from '../src/index.ts';

const WRITER = join(import.meta.dirname, 'writer.ts');
const tmp = () => mkdtempSync(join(tmpdir(), 'mpos-test-'));

function freshDb(dir: string, terminalId = 'T1') {
  const path = join(dir, 'pos.db');
  const db = openNodeDb(path);
  openCore(db).initTerminal('owner', { terminalId, deviceId: `DEV-${terminalId}`, mode: 'LIVE', vatMode: 'VAT' });
  db.close();
  return path;
}

/** Start a writer; resolve with the seqs it confirmed. If killAfterMs is set, SIGKILL it mid-flight. */
function writer(dbPath: string, count: string, killAfterMs?: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRITER, dbPath, count], { stdio: ['ignore', 'pipe', 'pipe'] });
    const confirmed: number[] = [];
    let buf = '';
    let err = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop()!;
      for (const l of lines) if (l.startsWith('OK ')) confirmed.push(Number(l.slice(3)));
    });
    child.stderr.on('data', (d) => (err += d));
    if (killAfterMs != null) {
      const arm = () => setTimeout(() => child.kill('SIGKILL'), killAfterMs);
      child.stdout.once('data', arm); // kill only once it is actually writing
    }
    child.on('exit', (code, signal) => (signal === 'SIGKILL' || code === 0 ? resolve(confirmed) : reject(new Error(`writer exited ${code}: ${err}`))));
  });
}

function assertSound(path: string, confirmed: number[]) {
  const db = openNodeDb(path);
  try {
    const pos = openCore(db);
    expect(pos.verify().issues).toEqual([]);
    const seqs = new Set(db.all<{ seq: number }>(`SELECT seq FROM ledger_entry`).map((r) => r.seq));
    for (const s of confirmed) expect(seqs.has(s)).toBe(true); // nothing confirmed was lost
    expect(db.get(`SELECT count(*) AS n FROM journal`)).toEqual(db.get(`SELECT count(*) AS n FROM ledger_entry`));
    return seqs.size;
  } finally {
    db.close();
  }
}

describe('crash and power-loss simulation', () => {
  it('C-B4-kill-during-post / C-B8-gapless-after-crash: hard kills never lose a confirmed sale or leave a gap', async () => {
    const path = freshDb(tmp());
    const confirmed: number[] = [];
    for (let round = 0; round < 10; round++) {
      confirmed.push(...(await writer(path, 'forever', 20 + Math.floor(Math.random() * 150))));
      assertSound(path, confirmed); // sound after every crash, not just the last
    }
    expect(confirmed.length).toBeGreaterThan(20); // the kills really landed mid-stream
  }, 120_000);
});

describe('concurrency', () => {
  it('P-B8-gapless-under-concurrency: three processes posting at once share one gapless series', async () => {
    const path = freshDb(tmp());
    const results = await Promise.all([writer(path, '40'), writer(path, '40'), writer(path, '40')]);
    const confirmed = results.flat();
    expect(new Set(confirmed).size).toBe(confirmed.length);
    assertSound(path, confirmed);
    const db = openNodeDb(path);
    const nos = db.all<{ doc_no: number }>(`SELECT doc_no FROM ledger_entry WHERE doc_type = 'INVOICE' ORDER BY doc_no`).map((r) => r.doc_no);
    db.close();
    expect(nos).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
  }, 120_000);
});

describe('backup and restore', () => {
  const sale = { userId: 'c1', online: true, lines: [{ description: 'A', qtyMilli: 1000, unitPrice: 1000, vatClass: 'VATABLE' as const }], payments: [{ method: 'CASH', amount: 1000 }] };
  const code = async (p: () => unknown) => {
    try {
      await p();
      return 'ok';
    } catch (e) {
      return (e as CoreError).code;
    }
  };

  it('T-B4-restore-preserves-seq-gt: a restored terminal continues the same numbering and grand total', () => {
    const dir = tmp();
    const path = freshDb(dir);
    const db = openNodeDb(path);
    const pos = openCore(db);
    pos.postSale(sale);
    pos.postSale(sale);
    pos.zReading('s1');
    const hw = pos.highWater();
    backup(db, join(dir, 'b.mposbak'), 'correct horse battery', 'owner');
    db.close();

    const target = join(tmp(), 'new-device.db'); // the old tablet died; this is a fresh device
    restore(join(dir, 'b.mposbak'), 'correct horse battery', target, 'owner');
    const db2 = openNodeDb(target);
    const pos2 = openCore(db2);
    expect(pos2.highWater()).toEqual(hw);
    expect(pos2.postSale(sale).number).toBe('00000003');
    expect(pos2.verify().ok).toBe(true);
    expect(db2.all<{ action: string }>(`SELECT action FROM activity_log`).map((a) => a.action)).toContain('RESTORE');
    db2.close();
  });

  it('T-B4-restore-refuses-rewind: an older backup cannot overwrite newer data', async () => {
    const dir = tmp();
    const path = freshDb(dir);
    let db = openNodeDb(path);
    let pos = openCore(db);
    pos.postSale(sale);
    backup(db, join(dir, 'old.mposbak'), 'correct horse battery', 'owner');
    pos.postSale(sale); // invoice 2 has been printed and handed over since the backup
    const hw = pos.highWater()!;
    db.close();

    expect(await code(() => restore(join(dir, 'old.mposbak'), 'correct horse battery', path, 'owner'))).toBe('RESTORE_REWINDS');
    expect(await code(() => restore(join(dir, 'old.mposbak'), 'wrong passphrase!', join(tmp(), 'x.db'), 'owner'))).toBe('RESTORE_BAD_FILE');
    expect(await code(() => restore(join(dir, 'old.mposbak'), 'correct horse battery', join(tmp(), 'y.db'), 'owner', hw))).toBe('RESTORE_REWINDS');

    const other = freshDb(tmp(), 'T9');
    expect(await code(() => restore(join(dir, 'old.mposbak'), 'correct horse battery', other, 'owner'))).toBe('RESTORE_WRONG_TERMINAL');

    db = openNodeDb(path); // the refused restores left the live database untouched
    pos = openCore(db);
    expect(pos.highWater()).toEqual(hw);
    db.close();
  });

  it('refuses a weak passphrase', async () => {
    const db = openNodeDb(freshDb(tmp()));
    expect(await code(() => backup(db, join(tmp(), 'b'), 'short', 'owner'))).toBe('WEAK_PASSPHRASE');
    db.close();
  });
});
