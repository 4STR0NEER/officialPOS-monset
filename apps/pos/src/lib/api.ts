import type { Core } from '@monset/core';
import type { Sell } from '@monset/sell';
import type { App } from '../worker.ts';

// Typed calls into the worker: api.sell.addItem(...) returns a Promise of what the worker returned.
type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };

export class PosError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
let next = 0;

worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: { code: string; message: string } }>) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  if (e.data.ok) p.resolve(e.data.value);
  else p.reject(new PosError(e.data.error!.code, e.data.error!.message));
};

function proxy<T>(ns: string): Async<T> {
  return new Proxy({} as Async<T>, {
    get: (_t, method: string) => (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        const id = next++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, ns, method, args });
      }),
  });
}

export const api = { core: proxy<Core>('core'), sell: proxy<Sell>('sell'), app: proxy<App>('app') };
