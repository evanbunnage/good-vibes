import { fileURLToPath, URL } from 'node:url'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The Worker (worker/index.ts) runs inside the dev server too, so /api works locally; not in tests.
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), ...(process.env.VITEST ? [] : [cloudflare()])],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
