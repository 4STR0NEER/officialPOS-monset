import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Compliance (brief §3): no silent auto-updates to the compliance core, including through the
// PWA service worker. A new version must wait for a supervisor to install it after the Z reading.
it('T-A3-sw-no-autoupdate: the service worker waits for a deliberate install', () => {
  const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  expect(config).toMatch(/registerType:\s*'prompt'/);
  expect(config).not.toMatch(/skipWaiting:\s*true|clientsClaim:\s*true|registerType:\s*'autoUpdate'/);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  expect(app).toMatch(/onNeedRefresh/);
  const settings = readFileSync(new URL('../src/screens/Settings.tsx', import.meta.url), 'utf8');
  expect(settings).toMatch(/Run the Z reading first/);
  expect(settings).toMatch(/askPin\('Install the software update'\)/);
});
