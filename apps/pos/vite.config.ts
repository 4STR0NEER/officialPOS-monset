import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Compliance: updates are never installed silently. A new version waits until a
    // supervisor installs it from Settings after the day's Z reading (registerType 'prompt').
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      workbox: { globPatterns: ['**/*.{js,css,html,svg,wasm,woff2}'], maximumFileSizeToCacheInBytes: 8 * 1024 * 1024 },
      manifest: {
        name: 'Monset POS',
        short_name: 'Monset POS',
        display: 'standalone',
        orientation: 'landscape',
        background_color: '#0b1a2e',
        theme_color: '#0b1a2e',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
});
