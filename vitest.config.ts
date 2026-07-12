import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/renderer/src/**/*.test.{ts,tsx}'],
    env: {
      // Keep TTS detached in tests even if the shell has a real key set.
      VITE_OPENAI_API_KEY: ''
    }
  }
})
