// The only thing the core needs from a runtime: synchronous SQLite.
// Adapters: @monset/storage-node (node:sqlite) now, sqlite-wasm (PWA worker) in Phase 3.
export type Param = string | number | null;

export interface Db {
  exec(sql: string): void;
  run(sql: string, ...params: Param[]): void;
  get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[];
}
