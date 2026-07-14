import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@renderer': resolve('src/renderer/src')
          }
        },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/src/**/*.test.{ts,tsx}'],
          env: {
            // Keep TTS detached in tests even if the shell has a real key set.
            VITE_OPENAI_API_KEY: ''
          }
        }
      },
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts']
        }
      }
    ]
  }
})
