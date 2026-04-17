// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,          // serial — tests share state within a file
  retries: 0,
  workers: 1,                    // single worker — sequential test execution
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  /* Start both server and dashboard before running tests */
  webServer: [
    {
      command: 'node index.js',
      cwd: './server',
      port: 4000,
      reuseExistingServer: true,
      env: {
        DATABASE_URL: 'postgresql://postgres@localhost:55432/auleg_smoke',
        JWT_SECRET: 'e2e-playwright-secret-minimum-32-chars!!',
        LOG_LEVEL: 'silent',
        NODE_ENV: 'development',
        CORS_ORIGIN: 'http://localhost:3000',
        PORT: '4000',
      },
    },
    {
      command: 'npx react-scripts start',
      cwd: './dashboard',
      port: 3000,
      reuseExistingServer: true,
      env: {
        BROWSER: 'none',
        PORT: '3000',
        REACT_APP_API_URL: 'http://localhost:4000/api',
      },
    },
  ],
});
