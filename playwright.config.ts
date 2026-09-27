import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

function systemChromium(): string | undefined {
  const configured = process.env.MORA_E2E_BROWSER_PATH;
  const candidates = [
    configured,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

const executablePath = systemChromium();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { baseURL: 'http://127.0.0.1:3107', locale: 'zh-CN', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: executablePath ? { executablePath } : undefined,
    },
  }],
  webServer: { command: 'node e2e/server.mjs', url: 'http://127.0.0.1:3107/api/health', reuseExistingServer: false, timeout: 60_000 },
  globalTeardown: './e2e/global-teardown.mjs',
});
