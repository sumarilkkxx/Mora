import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, run) => {
    const errors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', error => errors.push(`pageerror: ${error.stack ?? error.message}`));

    try {
      await run(page);
    } finally {
      // Stop media requests before Playwright closes the context. Abruptly
      // tearing down an active Range response makes Next report ECONNRESET as
      // an unhandled server error and hides genuine runtime failures in noise.
      if (!page.isClosed()) {
        await page.evaluate(() => {
          for (const media of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
            media.pause();
            media.srcObject = null;
            media.removeAttribute('src');
            media.load();
          }
        }).catch(() => undefined);
        await page.waitForTimeout(100);
      }
    }

    expect(errors, `浏览器运行时出现未处理错误:\n${errors.join('\n')}`).toEqual([]);
  },
});

export { expect };
export type { APIRequestContext } from '@playwright/test';
