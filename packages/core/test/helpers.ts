import { openCore, type SaleLine, type TerminalInit } from '@monset/core';
import { openNodeDb } from '@monset/storage-node';

/** A controllable clock: every call to now() moves one second forward unless frozen. */
export function clock(start = '2026-10-26T01:00:00.000Z') {
  let t = Date.parse(start);
  return {
    now: () => new Date((t += 1000)),
    set: (iso: string) => void (t = Date.parse(iso)),
    shift: (ms: number) => void (t += ms),
  };
}

export const SELLER = { registeredName: 'Kusina ni Lola Corp.', businessName: "Lola's Kitchen", address: '12 Osmeña Blvd, Cebu City 6000', tin: '123456789' };

export const TERMINAL: TerminalInit = { terminalId: 'T1', deviceId: 'DEV-1', mode: 'LIVE', vatMode: 'VAT' };

export function make(init: Partial<TerminalInit> = {}, path = ':memory:') {
  const db = openNodeDb(path);
  const c = clock();
  const pos = openCore(db, { now: c.now });
  pos.initTerminal('owner', { ...TERMINAL, ...init });
  pos.configureSeller('owner', SELLER);
  return { db, pos, clock: c };
}

export const line = (unitPrice: number, qty = 1, vatClass: SaleLine['vatClass'] = 'VATABLE', description = 'Item'): SaleLine => ({
  description, qtyMilli: qty * 1000, unitPrice, vatClass,
});

export const cash = (amount: number) => [{ method: 'CASH', amount }];

/** Printed text with line wrapping undone, for content checks independent of paper width. */
export const flat = (s: string) => s.replace(/\s+/g, ' ');
