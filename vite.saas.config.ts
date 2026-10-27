import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'

// Tremplin (SaaS idea generator). GitHub Pages serves the main branch as-is, so the build is
// committed to /saas and uses relative paths: https://ashuto796-boop.github.io/hunter/saas/
export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL('./src/saas', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./saas', import.meta.url)),
    emptyOutDir: true,
  },
})
