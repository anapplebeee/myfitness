import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 配置。
 *
 * 刻意使用**系统已安装的 Edge**（channel: 'msedge'），不下载 Playwright 自带浏览器：
 * 项目要求离线可构建，且下载 Chromium 需数百 MB。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 8_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    ...devices['Desktop Chrome'],
    // 本地开发用系统 Edge（免下载）；CI 用 Playwright 自带 Chromium。
    channel: process.env.E2E_CHANNEL ?? 'msedge',
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },

  webServer: {
    // 先构建再用静态服务器托管，确保测的是真实产物而非 dev 中间态
    command: 'npm run build && node scripts/serve.mjs dist 4173',
    url: 'http://127.0.0.1:4173',
    // 刻意不复用已有服务器：本地若残留一个跑着旧 dist 的进程，
    // 复用它会让测试"通过"或"失败"都基于过期产物，排查代价极高。
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

