import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/spatial-study-6-webxr/',
  build: {
    rollupOptions: {
      input: {
        experiment: resolve(import.meta.dirname, 'index.html'),
        companion: resolve(import.meta.dirname, 'companion.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
