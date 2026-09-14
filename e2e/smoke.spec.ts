import { test, expect } from '@playwright/test';

test('首页提供视频创作入口', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/start$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('爆款推广视频，一站式完成');
  await expect(page.getByRole('tablist')).toBeVisible();
});

test('商品库可加载真实空数据库', async ({ page }) => {
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: '商品库', exact: true })).toBeVisible();
});

test('任务中心可加载且刷新后保持正常', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '当前任务', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '当前任务', exact: true })).toBeVisible();
});

test('设置切换分区会更新 URL 并在刷新后保留', async ({ page }) => {
  await page.goto('/settings');
  const nav = page.locator('nav.studio-settings-nav');
  await nav.getByRole('button').last().click();
  await expect(page).toHaveURL(/tab=/);
  const url = page.url();
  const selected = await nav.locator('[aria-current="page"]').innerText();
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(nav.locator('[aria-current="page"]')).toHaveText(selected);
});

test('项目通过 API 创建后可在任务列表之外的项目列表读取', async ({ request }) => {
  const created = await request.post('/api/project', { data: { name: 'E2E 隔离项目', workflowType: 'edit' } });
  expect(created.status()).toBe(201);
  const project = await created.json();
  const list = await request.get('/api/project');
  expect(list.ok()).toBeTruthy();
  expect(await list.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: project.id, name: 'E2E 隔离项目', workflowType: 'edit' })]));
});
