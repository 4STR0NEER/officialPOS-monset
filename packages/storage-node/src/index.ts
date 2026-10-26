import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { checkRestore, CoreError, openCore, verifyAll, type Db, type HighWater } from '@monset/core';

export type NodeDb = Db & { close(): void; path: string };

/** node:sqlite with the settings that make a committed sale survive a power cut. */
export function openNodeDb(path: string): NodeDb {
  const d = new DatabaseSync(path);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;');
  const cache = new Map<string, StatementSync>();
  const st = (sql: string) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = d.prepare(sql)));
    return s;
  };
  return {
    path,
    exec: (sql) => d.exec(sql),
    run: (sql, ...p) => void st(sql).run(...p),
    get: (sql, ...p) => st(sql).get(...p) as never,
    all: (sql, ...p) => st(sql).all(...p) as never,
    close: () => d.close(),
  };
}

const MAGIC = Buffer.from('MPOSBK1\n');
const key = (pass: string, salt: Buffer) => scryptSync(pass, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

/** Encrypted snapshot (AES-256-GCM, scrypt key). The file is useless without the client's passphrase. */
export function backup(db: NodeDb, outFile: string, passphrase: string, userId: string): void {
  if (!passphrase || passphrase.length < 8) throw new CoreError('WEAK_PASSPHRASE', 'use a passphrase of at least 8 characters');
  const tmp = `${outFile}.plain.tmp`;
  rmSync(tmp, { force: true });
  db.run(`VACUUM INTO ?`, tmp);
  const plain = readFileSync(tmp);
  rmSync(tmp);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(passphrase, salt), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  writeFileSync(`${outFile}.tmp`, Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]));
  renameSync(`${outFile}.tmp`, outFile);
  openCore(db).record(userId, 'BACKUP', outFile, null, { bytes: plain.length });
}

/**
 * Restore an encrypted backup onto targetPath. Refuses a corrupt backup, a backup from another
 * terminal, or one older than what the target (or a known high-water mark, e.g. the hub replica
 * or the last printed Z) already shows. The target database must be closed by the caller.
 */
export function restore(backupFile: string, passphrase: string, targetPath: string, userId: string, knownHighWater?: HighWater): void {
  const buf = readFileSync(backupFile);
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new CoreError('RESTORE_BAD_FILE', 'not a Monset POS backup');
  let o = MAGIC.length;
  const salt = buf.subarray(o, (o += 16));
  const iv = buf.subarray(o, (o += 12));
  const tag = buf.subarray(o, (o += 16));
  let plain: Buffer;
  try {
    const d = createDecipheriv('aes-256-gcm', key(passphrase, salt), iv);
    d.setAuthTag(tag);
    plain = Buffer.concat([d.update(buf.subarray(o)), d.final()]);
  } catch {
    throw new CoreError('RESTORE_BAD_FILE', 'wrong passphrase or damaged backup');
  }

  const staged = `${targetPath}.restore.tmp`;
  rmSync(staged, { force: true });
  writeFileSync(staged, plain);
  const cand = openNodeDb(staged);
  try {
    const issues = verifyAll(cand);
    if (issues.length) throw new CoreError('RESTORE_BAD_FILE', `backup fails integrity check: ${issues[0].kind} ${issues[0].detail}`);
    const candHw = openCore(cand).highWater();
    if (existsSync(targetPath)) {
      const cur = openNodeDb(targetPath);
      try {
        checkRestore(openCore(cur).highWater(), candHw);
      } finally {
        cur.close();
      }
    }
    checkRestore(knownHighWater ?? null, candHw);
    openCore(cand).record(userId, 'RESTORE', backupFile, null, candHw);
  } catch (e) {
    cand.close();
    rmSync(staged, { force: true });
    throw e;
  }
  cand.close();
  for (const ext of ['-wal', '-shm']) rmSync(targetPath + ext, { force: true });
  renameSync(staged, targetPath);
}
