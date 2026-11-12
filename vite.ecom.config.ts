import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'

// Vitrine (Shopify shop run by 10 agents). GitHub Pages serves the main branch as-is, so the
// build is committed to /ecom and uses relative paths: https://ashuto796-boop.github.io/hunter/ecom/
export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL('./src/ecom', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./ecom', import.meta.url)),
    emptyOutDir: true,
  },
})
