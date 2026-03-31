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
});
