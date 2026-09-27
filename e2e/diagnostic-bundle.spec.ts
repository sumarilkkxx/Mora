import { readFileSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { test, expect } from './fixtures';

test('用户可本地生成、逐文件预览、导出并取消诊断包', async ({ page }, info) => {
  await page.goto('/settings?tab=diagnostics');
  await expect(page.getByRole('heading', { name: '系统诊断' })).toBeVisible();
  await expect(page.getByText(/不会自动上传或发送诊断包/)).toBeVisible();

  const externalRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(request.url());
  });

  await page.getByRole('button', { name: '生成本地诊断' }).click();
  await expect(page.getByRole('button', { name: /diagnostics\.json/ })).toBeVisible();
  await page.getByRole('button', { name: /diagnostics\.json/ }).click();
  const preview = page.getByLabel('诊断文件内容预览');
  await expect(preview).toContainText('mora-diagnostics');
  await expect(preview).toContainText('migrationVersion');
  await expect(preview).toContainText('ffmpeg');
  expect(externalRequests).toEqual([]);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出诊断包' }).click();
  const download = await downloadPromise;
  const downloadPath = info.outputPath('mora-diagnostics.zip');
  await download.saveAs(downloadPath);
  const archive = new AdmZip(readFileSync(downloadPath));
  expect(archive.getEntries().map(entry => entry.entryName).sort()).toEqual(['README.txt', 'diagnostics.json', 'manifest.json']);
  expect(archive.readAsText('diagnostics.json')).toContain('mora-diagnostics');
  await expect(page.getByText(/未上传或发送/)).toBeVisible();

  await page.getByRole('button', { name: '生成本地诊断' }).click();
  await expect(page.getByRole('button', { name: '导出诊断包' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('诊断操作已取消。')).toBeVisible();
  await expect(page.getByRole('button', { name: '导出诊断包' })).toHaveCount(0);
});
