/// <reference lib="webworker" />
// Everything that touches the ledger runs here, off the UI thread, on SQLite in the browser's
// private file system. The screens talk to it through the small RPC in lib/api.ts.
import { openCore, type Core, type Seller, type VatMode } from '@monset/core';
import { openSell, type Role, type Sell } from '@monset/sell';
import { seedDemo, DEMO_PINS } from '@monset/sell/demo';
import { openMemoryDb, openOpfsDb, type WasmDb } from '@monset/storage-wasm';

let db: WasmDb;
let core: Core;
let sell: Sell;
let persistent = false;

const ready = (async () => {
  try {
    db = await openOpfsDb();
    persistent = true;
  } catch (e) {
    // No OPFS (very old browser or a private window): run, but say loudly that nothing is kept.
    console.error('OPFS unavailable, running in memory', e);
    db = await openMemoryDb();
  }
  core = openCore(db);
  sell = openSell(db, core);
})();

export interface SetupInput {
  demo: boolean;
  terminalId: string;
  vatMode: VatMode;
  seller: Seller;
  owner?: { name: string; pin: string; role?: Role };
}

const app = {
  status() {
    const s = core.state();
    return {
      persistent,
      terminal: s.terminal,
      seller: s.seller,
      supplier: s.supplier,
      locked: s.locked,
      issues: s.issues,
      coreVersion: s.coreVersion,
      hasStaff: sell.hasStaff(),
      demoPins: s.terminal?.mode === 'DEMO' ? DEMO_PINS : null,
    };
  },
  setup(o: SetupInput) {
    core.initTerminal('setup', { terminalId: o.terminalId, deviceId: crypto.randomUUID(), mode: o.demo ? 'DEMO' : 'LIVE', vatMode: o.vatMode });
    core.configureSeller('setup', o.seller);
    if (o.demo) seedDemo(sell);
    else if (o.owner) sell.addStaff(null, { name: o.owner.name, role: 'owner', pin: o.owner.pin });
  },
};
export type App = typeof app;

const targets = () => ({ core, sell, app }) as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>;

self.onmessage = async (e: MessageEvent<{ id: number; ns: string; method: string; args: unknown[] }>) => {
  const { id, ns, method, args } = e.data;
  await ready;
  try {
    const value = await targets()[ns][method](...args);
    self.postMessage({ id, ok: true, value });
  } catch (err) {
    const x = err as { code?: string; message?: string };
    self.postMessage({ id, ok: false, error: { code: x.code ?? 'ERROR', message: x.message ?? String(err) } });
  }
};
