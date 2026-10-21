import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { target: 'safari18', assetsInlineLimit: 0 },
  server: { port: 5188, strictPort: true },
})
