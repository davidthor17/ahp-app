import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // The build's own age, so the console can notice it has been running an old
  // bundle for weeks. Without it, "no update available" and "I have not
  // successfully asked since August" are indistinguishable from inside the app,
  // which is how a 5 August build survived into September.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate'.
      //
      // autoUpdate was set and did nothing, because virtual:pwa-register was
      // never imported: the generated registerSW.js was a bare
      // navigator.serviceWorker.register with no update handling at all.
      // Wiring autoUpdate up properly would have been worse, because it
      // reloads the page the moment a new worker activates, and an automatic
      // reload destroys the in-memory write queue. 'prompt' builds a worker
      // that waits until the app asks it to take over, so the reload is always
      // the auditor's decision and can be refused while writes are unsaved.
      registerType: 'prompt',
      manifest: {
        name: 'Auditor Hotel Program — Audit Console',
        short_name: 'A·H·P Audit',
        description: 'Internal audit console for the Auditor Hotel Program.',
        theme_color: '#0B0F0D',
        background_color: '#0C0C0F',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // caches the app shell so it opens even with no signal at the property
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
});
