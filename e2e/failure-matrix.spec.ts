import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { ReplicateProvider } from '../src/lib/providers/replicate';
import { ProjectPackageService } from '../src/lib/project-package';
import * as schema from '../src/lib/db/schema';
import { test, expect } from './fixtures';

function databasePath() {
  const state = JSON.parse(readFileSync(join(process.cwd(), 'test-results/e2e-server-state.json'), 'utf8'));
  return join(state.root, 'data', 'sqlite.db');
}

async function faultServer(status: number, delayMs = 0) {
  let submissions = 0;
  const server = createServer((_req, res) => {
    submissions += 1;
    setTimeout(() => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `fixture-${status}` } }));
    }, delayMs);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    get submissions() { return submissions; },
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('Provider 401 给出重新配置凭据的下一步且不重复提交', async ({ request }) => {
  const provider = await faultServer(401);
  try {
    const response = await request.post('/api/ai/image', { data: { provider: 'replicate', model: 'black-forest-labs/flux-schnell', prompt: 'fixture', apiKey: 'invalid', baseUrl: provider.baseUrl } });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ category: 'authentication', retryable: false });
    expect(body.error).toMatch(/401|unauthorized/i);
    expect(provider.submissions).toBe(1);
  } finally { await provider.close(); }
});

test('Provider 5xx 保留可恢复任务且不重复计费请求', async ({ request }) => {
  const provider = await faultServer(503);
  try {
    const response = await request.post('/api/ai/video', { data: { provider: 'replicate', model: 'bytedance/seedance-1-pro', mode: 'text-to-video', prompt: 'fixture', apiKey: 'fixture', baseUrl: provider.baseUrl, options: { duration: 5, width: 1280, height: 720 } } });
    expect(response.status()).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ category: 'network_retryable', retryable: true });
    expect(provider.submissions).toBe(1);
  } finally { await provider.close(); }
});

test('Provider 超时保留可恢复任务并警告不要重复提交', async () => {
  const provider = await faultServer(200, 500);
  try {
    const client = new ReplicateProvider({ name: 'replicate', apiKey: 'fixture', baseUrl: provider.baseUrl, timeout: 50 });
    await expect(client.generateVideo({ modelId: 'bytedance/seedance-1-pro', mode: 'text-to-video', prompt: 'fixture' }))
      .rejects.toMatchObject({ code: 'TIMEOUT' });
    await expect(client.generateVideo({ modelId: 'bytedance/seedance-1-pro', mode: 'text-to-video', prompt: 'fixture' }))
      .rejects.toThrow(/可能已受理.*不要直接重试提交/);
    expect(provider.submissions).toBe(2);
  } finally { await provider.close(); }
});

test('进程重启后的过期租约保留检查点并进入可恢复状态', async ({ request, page }) => {
  const project = await (await request.post('/api/project', { data: { name: 'Restart fixture', workflowType: 'generate' } })).json();
  const runId = randomUUID();
  const sqlite = new Database(databasePath());
  try {
    sqlite.prepare(`insert into operation_runs (id, kind, subject_id, request_key, status, stage, attempt, owner, lease_until, checkpoint, created_at, updated_at)
      values (?, 'pipeline', ?, ?, 'running', 'stock_fill', 1, 'dead-process', 1, ?, ?, ?)`)
      .run(runId, project.id, `restart:${runId}`, JSON.stringify({ completedStage: 'script', artifactId: 'kept' }), Date.now() - 1000, Date.now() - 1000);
  } finally { sqlite.close(); }
  const feed = await (await request.get('/api/tasks')).json();
  expect(feed.attention).toEqual(expect.arrayContaining([expect.objectContaining({ id: runId, status: 'interrupted', stage: 'stock_fill' })]));
  const verify = new Database(databasePath(), { readonly: true });
  try {
    const row = verify.prepare('select status, checkpoint from operation_runs where id = ?').get(runId) as { status: string; checkpoint: string };
    expect(row.status).toBe('interrupted');
    expect(JSON.parse(row.checkpoint)).toEqual({ completedStage: 'script', artifactId: 'kept' });
  } finally { verify.close(); }
  await page.goto('/tasks');
  await expect(page.getByText('Restart fixture')).toBeVisible();
});

test('成片文件丢失时发布工具明确失败且保留已完成记录', async ({ request }) => {
  const project = await (await request.post('/api/project', { data: { name: 'Missing file fixture', workflowType: 'generate' } })).json();
  const compositionId = randomUUID();
  const sqlite = new Database(databasePath());
  try {
    sqlite.prepare(`insert into compositions (id, project_id, status, output_path, resolution, aspect_ratio, created_at, completed_at)
      values (?, ?, 'done', ?, '720p', '16:9', ?, ?)`)
      .run(compositionId, project.id, join(tmpdir(), `missing-${compositionId}.mp4`), Date.now(), Date.now());
  } finally { sqlite.close(); }
  const cover = await request.post(`/api/project/${project.id}/cover`, { data: { title: 'missing' } });
  expect(cover.status()).toBe(404);
  expect((await cover.json()).error).toMatch(/不存在|does not exist/i);
  const compositions = await (await request.get(`/api/project/${project.id}/compositions`)).json();
  expect(compositions.compositions).toEqual(expect.arrayContaining([expect.objectContaining({ id: compositionId, status: 'done' })]));
});

test('磁盘空间不足拒绝导入且不留下半成品', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mora-disk-e2e-'));
  const source = new Database(':memory:');
  const target = new Database(':memory:');
  try {
    migrate(drizzle(source, { schema }), { migrationsFolder: join(process.cwd(), 'drizzle') });
    migrate(drizzle(target, { schema }), { migrationsFolder: join(process.cwd(), 'drizzle') });
    source.prepare("insert into projects (id, name, product_images, media_insights, version_snapshots, is_evaluation) values ('disk-source', 'fixture', '[]', '[]', '[]', 0)").run();
    const archive = join(root, 'fixture.mora');
    await new ProjectPackageService({ database: source, dataDir: join(root, 'source') }).export('disk-source', archive);
    const service = new ProjectPackageService({ database: target, dataDir: join(root, 'target') });
    await expect(service.importPackage(archive, { limits: { minimumFreeBytes: Number.MAX_SAFE_INTEGER } }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_DISK' });
    expect(target.prepare('select count(*) as count from projects').get()).toEqual({ count: 0 });
  } finally {
    source.close();
    target.close();
    rmSync(root, { recursive: true, force: true });
  }
});
