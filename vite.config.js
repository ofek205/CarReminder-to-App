import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
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
          'vendor-editor': ['react-quill', 'react-markdown'],
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
});
