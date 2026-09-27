import { test, expect } from './fixtures';

test('旧浏览器资料迁入 SQLite 后清空 localStorage 仍可恢复，凭据不进入 API 快照', async ({ page, request }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('mora-e2e-legacy-seeded')) return;
    sessionStorage.setItem('mora-e2e-legacy-seeded', '1');
    localStorage.setItem('daihuo-jianshou-products', JSON.stringify({ state: { products: [{
      id: 'legacy-product', name: '迁移商品', category: 'beauty', images: [], videoCount: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    }] } }));
    localStorage.setItem('daihuo-jianshou-settings', JSON.stringify({ state: {
      llm: { provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'e2e-browser-secret', model: 'test-model' },
      locale: 'zh-CN', localeSource: 'user',
    } }));
  });

  await page.goto('/products');
  await expect(page.getByText('迁移商品', { exact: true })).toBeVisible();
  const state = await (await request.get('/api/local-state')).json();
  expect(state.products).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'legacy-product', videoCount: 3 })]));
  expect(JSON.stringify(state)).not.toContain('e2e-browser-secret');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('daihuo-jianshou-products'))).toBeNull();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('mora-credentials-session-v1'))).toContain('e2e-browser-secret');

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText('迁移商品', { exact: true })).toBeVisible();

  const repeated = await request.post('/api/local-state', { data: state });
  expect(repeated.ok()).toBeTruthy();
  expect(await repeated.json()).toEqual({ migrated: false });
  expect((await (await request.get('/api/local-state')).json()).products.filter((item: { id: string }) => item.id === 'legacy-product')).toHaveLength(1);
});
