import { defineConfig, devices } from '@playwright/test'

const remoteBaseURL = process.env.PLAYWRIGHT_BASE_URL
const baseURL = remoteBaseURL ?? 'http://127.0.0.1:3125'

// Server modes:
// - default: Playwright boots the full `pnpm dev:e2e` stack (web 3125, game
//   server 3225) and tears it down afterwards.
// - PW_REUSE_SERVER=1: reuse an already-running dev:e2e stack. There are zero
//   automatic retries locally and two in CI; neither mode restarts a reused
//   server for a retry. If reuse flakes, manually stop the existing stack and
//   rerun with PW_REUSE_SERVER and PLAYWRIGHT_BASE_URL unset for a fresh stack.
// - PLAYWRIGHT_BASE_URL: run against your own dev server (for example a
//   `pnpm dev` server on 127.0.0.1:3000). Keep both web and game server
//   processes running; first hits on cold routes pay on-demand compile
//   latency, so give WebKit runs a fresh server when in doubt.
if (remoteBaseURL && process.env.PW_REUSE_SERVER === '1') {
  console.warn(
    'PW_REUSE_SERVER only controls the Playwright-managed web server and is ignored when PLAYWRIGHT_BASE_URL is set. The tests will run against PLAYWRIGHT_BASE_URL as-is.',
  )
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 3,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    // Local runs use zero retries, so 'on-first-retry' would never record the
    // intermittent failures this suite is prone to. Keep traces for any
    // failing test so flakes can be inspected after the fact.
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, workers: 1 },
  ],
  webServer: remoteBaseURL
    ? undefined
    : {
        command:
          'cross-env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= pnpm dev:e2e',
        url: baseURL,
        reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
        timeout: 120_000,
      },
})
