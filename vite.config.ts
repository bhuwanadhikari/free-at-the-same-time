import { defineConfig } from 'vitest/config';
import type { Connect, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

// `/` is the static landing page (index.html). These routes belong to the React app (app.html).
// Keep in sync with the hosting rewrites in firebase.json.
const APP_ROUTE = /^\/(availability|matches|chats|profile)(\/|$)/;

/** Dev/preview counterpart of the firebase.json rewrites: serve app.html for app routes. */
function appRoutes(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const path = (req.url ?? '/').split('?')[0];
    if (APP_ROUTE.test(path)) req.url = '/app.html';
    next();
  };
  return {
    name: 'app-routes',
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  };
}

export default defineConfig({
  plugins: [
    appRoutes(),
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: '/',
        name: 'freeatthesametime.com',
        short_name: 'FreeAtSameTime',
        description: 'Find people who are free at the same time and start a group chat to make plans.',
        lang: 'en',
        // The landing page lives at `/`; the installed app opens straight into the planner.
        start_url: '/availability',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#5B2EFF',
        background_color: '#FFF7EE',
        categories: ['social', 'lifestyle', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Firestore and Auth traffic always goes to the network.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['**/*-latin-ext-*.woff2', '**/*-vietnamese-*.woff2', '**/*-cyrillic*.woff2', 'images/**', '404.html'],
        navigateFallback: '/app.html',
        // Only app routes fall back to the app shell; `/`, llms.txt etc. are served as themselves.
        navigateFallbackAllowlist: [APP_ROUTE],
        // Firebase Auth's reserved /__/auth/* pages must never be served from cache.
        navigateFallbackDenylist: [/^\/__\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // Firebase is most of the weight; separate chunks keep it cached across app releases.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      input: {
        landing: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app.html', import.meta.url)),
      },
      output: {
        codeSplitting: {
          groups: [
            { name: 'firebase', test: /node_modules[\\/](@firebase|firebase|re2js|idb)[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler|cookie|set-cookie-parser)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  server: { host: true, port: 5173, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
