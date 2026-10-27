import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Db, Param } from '@monset/core';

// SQLite compiled to WebAssembly. In the browser it runs inside a Web Worker on the
// OPFS "SAH pool" VFS: persistent, synchronous, and no COOP/COEP headers needed.
// In Node (tests) it runs in memory, which proves the core behaves the same on both engines.

type OoDb = {
  exec(o: { sql: string; bind?: Param[] }): unknown;
  selectObject(sql: string, bind?: Param[]): Record<string, unknown> | undefined;
  selectObjects(sql: string, bind?: Param[]): Record<string, unknown>[];
  close(): void;
};

export type WasmDb = Db & { close(): void; exportBytes?: () => Uint8Array };

function wrap(d: OoDb, exportBytes?: () => Uint8Array): WasmDb {
  d.exec({ sql: 'PRAGMA foreign_keys = ON;' });
  const b = (p: Param[]) => (p.length ? p : undefined);
  return {
    exec: (sql) => void d.exec({ sql }),
    run: (sql, ...p) => void d.exec({ sql, bind: b(p) }),
    get: (sql, ...p) => d.selectObject(sql, b(p)) as never,
    all: (sql, ...p) => d.selectObjects(sql, b(p)) as never,
    close: () => d.close(),
    exportBytes,
  };
}

/** In-memory database (tests, or a browser without OPFS). */
export async function openMemoryDb(): Promise<WasmDb> {
  const sqlite3 = await sqlite3InitModule();
  return wrap(new sqlite3.oo1.DB(':memory:', 'c') as unknown as OoDb);
}

/** Persistent database in the browser's origin-private file system. Call from a Web Worker. */
export async function openOpfsDb(file = '/monset-pos.sqlite3'): Promise<WasmDb> {
  const sqlite3 = await sqlite3InitModule();
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'monset-pos' });
  const db = new pool.OpfsSAHPoolDb(file) as unknown as OoDb;
  db.exec({ sql: 'PRAGMA synchronous = FULL;' });
  return wrap(db, () => pool.exportFile(file));
}
