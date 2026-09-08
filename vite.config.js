import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import { readFileSync } from 'fs'

// Read package.json once at build time and inline `version` as a
// global (`__APP_VERSION__`) so the UI can render "גרסה 2.7.2" in the
// settings screen without hardcoding it in a second place. Bumping
// `version` in package.json updates the value automatically on the
// next build — single source of truth, same string the Play Store
// release pipeline reads.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig(({ command, mode }) => {
  // ── Dev-login credentials — development builds ONLY ──────────────
  //
  // History, because this looks like it could be simplified and it can't:
  // the 2026-05-27 audit found VITE_DEV_EMAIL / VITE_DEV_PASSWORD sitting
  // in the production `dist` even though every read was wrapped in
  // `import.meta.env.DEV` — Vite inlines VITE_* values BEFORE dead-code
  // elimination, so the guard never removed the literals. The vars were
  // renamed without the prefix so Vite stops exposing them to the client
  // at all. That fixed the leak but left AuthPage with no way to read
  // them, so a fallback account was hardcoded instead — and it went stale,
  // which is why the documented `00`/`00` dev login stopped working.
  //
  // `loadEnv` with an empty prefix reads .env.local here, in Node, at
  // config time.
  //
  // ⚠️ An empty prefix means `env` holds EVERYTHING in .env.local —
  // including SUPABASE_SERVICE_ROLE_KEY. Never spread it (`...env`) into
  // `define`, and never read a key from it that the browser has no
  // business seeing. Only DEV_EMAIL / DEV_PASSWORD are taken below.
  //
  // The gate is `command === 'serve'`, not `mode === 'development'`:
  // keying on mode alone would still inject the credentials for anyone
  // running `vite build --mode development`. Tying it to the dev SERVER
  // means no build of any mode can carry them.
  //
  // Verify after any change to this block:
  //   npm run build && grep -ri "DEV_EMAIL\|DEV_PASSWORD" dist/
  // The only hit allowed is src/lib/envValidator (the leak DETECTOR).
  const env = loadEnv(mode, process.cwd(), '');
  const devCreds =
    command === 'serve' && env.DEV_EMAIL && env.DEV_PASSWORD
      ? { email: env.DEV_EMAIL, password: env.DEV_PASSWORD }
      : null;

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_CREDS__: JSON.stringify(devCreds),
    },
    server: {
      proxy: {
        '/gov-api': {
          target: 'https://data.gov.il',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/gov-api/, ''),
        },
      },
    },
    plugins: [
      react(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    // Capacitor loads from file:// so paths must be relative
    base: './',
    build: {
      // Raise warning threshold slightly — a few chunks will still be ~500-700KB
      // due to bundling strategy, but we want real signal for anything beyond that.
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          // Split heavy vendor code into its own chunks so the main bundle stays lean.
          // Only code that actually runs on the first page gets bundled into "index".
          manualChunks: {
            // Charts — only loaded on AdminDashboard (recharts is ~400KB raw)
            'vendor-charts': ['recharts'],
            // Maps — only loaded on FindGarage (leaflet + react-leaflet)
            'vendor-maps': ['leaflet', 'react-leaflet'],
            // Rich text — only loaded on forms that use it
            'vendor-editor': ['react-markdown'],
            // Date helpers — used throughout but standalone
            'vendor-date': ['date-fns'],
            // Supabase SDK — large but used everywhere, keep standalone
            'vendor-supabase': ['@supabase/supabase-js'],
            // Radix primitives — keep together so React resolves them once
            'vendor-radix': [
              '@radix-ui/react-dialog',
              '@radix-ui/react-popover',
              '@radix-ui/react-select',
              '@radix-ui/react-tabs',
              '@radix-ui/react-switch',
              '@radix-ui/react-slot',
            ],
          },
        },
      },
    },
  };
});
