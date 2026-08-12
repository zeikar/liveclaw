import { defineConfig } from '@playwright/test'

// Electron e2e only. The unit suites stay in vitest (`vitest.config.ts`), which scopes itself to
// `src/**` — the two never see each other's files.
export default defineConfig({
  testDir: './e2e',
  // One Electron app at a time: the suite launches a real app that binds a real userData dir.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: 'list',
  forbidOnly: !!process.env.CI
})
