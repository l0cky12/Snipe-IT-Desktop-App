import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  // SVGs ship as files: the page's CSP (default-src 'self') blocks the data: URLs Vite would inline them as.
  renderer: { plugins: [react()], build: { assetsInlineLimit: (file) => (file.endsWith('.svg') ? false : undefined) } },
})
