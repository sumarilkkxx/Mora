import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

test('screenshot: template page', async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  // Click step 2 (template) from header rail.
  await page.getByRole('button', { name: /模板编排/i }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/template-1280.png', fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/template-390.png', fullPage: false });
});
