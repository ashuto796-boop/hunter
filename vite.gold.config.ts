import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'

// AURUM (gold AI trader). GitHub Pages serves the main branch as-is, so the build is
// committed to /gold and uses relative paths: https://ashuto796-boop.github.io/hunter/gold/
export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL('./src/gold', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./gold', import.meta.url)),
    emptyOutDir: true,
  },
})
