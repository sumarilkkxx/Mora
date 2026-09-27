import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import ffmpegPath from 'ffmpeg-static';
import probeInstaller from '@ffprobe-installer/ffprobe';
import { test, expect, type APIRequestContext } from './fixtures';

const ffmpeg = ffmpegPath!;
const ffprobe = probeInstaller.path;
let fixtureRoot = '';
let video = '';
let image = '';

test.beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'mora-advanced-e2e-'));
  video = join(fixtureRoot, 'fixture.mp4');
  image = join(fixtureRoot, 'fixture.png');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', video]);
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:size=320x320', '-frames:v', '1', '-y', image]);
});

test.afterAll(() => { if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true }); });

function dataUri(type: string, file: string) {
  return `data:${type};base64,${readFileSync(file).toString('base64')}`;
}

async function startReplicateFixture() {
  const calls: string[] = [];
  const outputs = new Map<string, string>();
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    if (req.method === 'POST' && req.url?.includes('/predictions')) {
      const id = req.url.includes('seedance') ? 'video-task' : 'image-task';
      calls.push(id);
      outputs.set(id, id === 'video-task' ? dataUri('video/mp4', video) : dataUri('image/png', image));
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id, status: 'starting' }));
    }
    const id = req.url?.split('/').pop() ?? '';
    if (req.method === 'GET' && outputs.has(id)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id, status: 'succeeded', output: outputs.get(id), metrics: { predict_time: 1 } }));
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    calls,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function createProject(request: APIRequestContext, name: string) {
  const response = await request.post('/api/project', { data: { name, workflowType: 'edit', workflowMode: 'guided_edit' } });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

function databasePath() {
  const state = JSON.parse(readFileSync(join(process.cwd(), 'test-results/e2e-server-state.json'), 'utf8'));
  return join(state.root, 'data', 'sqlite.db');
}

test('固定 Provider 的商品图片和生成式视频可落盘为真实项目素材', async ({ request, page }, info) => {
  const provider = await startReplicateFixture();
  try {
    const project = await createProject(request, `Generated-${randomUUID()}`);
    const common = { provider: 'replicate', apiKey: 'fixture-only', baseUrl: provider.baseUrl };
    const imageResponse = await request.post('/api/ai/image', { data: { ...common, model: 'black-forest-labs/flux-schnell', mode: 'text-to-image', prompt: 'fixture product image' } });
    expect(imageResponse.ok(), await imageResponse.text()).toBeTruthy();
    const imageResult = await imageResponse.json();
    const savedImage = await request.post(`/api/project/${project.id}/assets`, { data: { shotId: 1, type: 'ai_generate', sourceUrl: imageResult.imageUrls[0], provider: 'replicate', model: imageResult.modelId, prompt: 'fixture product image' } });
    expect(savedImage.ok(), await savedImage.text()).toBeTruthy();
    const imageAsset = await savedImage.json();
    expect((await request.get(imageAsset.filePath)).ok()).toBeTruthy();

    const videoResponse = await request.post('/api/ai/video', { data: { ...common, model: 'bytedance/seedance-1-pro', mode: 'text-to-video', prompt: 'fixture product motion', options: { duration: 5, width: 1280, height: 720 } } });
    expect(videoResponse.ok(), await videoResponse.text()).toBeTruthy();
    const videoResult = await videoResponse.json();
    const savedVideo = await request.post(`/api/project/${project.id}/assets`, { data: { shotId: 2, type: 'ai_generate', sourceUrl: videoResult.videoUrls[0], provider: 'replicate', model: videoResult.modelId, prompt: 'fixture product motion' } });
    expect(savedVideo.ok(), await savedVideo.text()).toBeTruthy();
    const videoAsset = await savedVideo.json();
    const bytes = await (await request.get(videoAsset.filePath)).body();
    const output = info.outputPath('generated-provider-video.mp4');
    writeFileSync(output, bytes);
    const metadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { encoding: 'utf8' }));
    expect(metadata.streams.some((stream: { codec_type: string }) => stream.codec_type === 'video')).toBe(true);
    expect(metadata.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio')).toBe(true);
    execFileSync(ffmpeg, ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-']);
    expect(provider.calls).toEqual(['image-task', 'video-task']);

    const rows = await (await request.get(`/api/project/${project.id}/assets`)).json();
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ shotId: 1, status: 'done' }), expect.objectContaining({ shotId: 2, status: 'done' })]));
    await page.goto(`/project/${project.id}/assets`);
    await expect(page.locator('.project-workspace-header')).toHaveCount(1);
    await page.waitForLoadState('networkidle');
  } finally { await provider.close(); }
});

test('批量制作状态跨刷新保留且已完成条目不会重复执行', async ({ request, page }) => {
  const requestId = randomUUID();
  const body = { requestId, config: { fixture: true }, items: [{ productId: 'p1', productName: '商品一' }, { productId: 'p2', productName: '商品二' }] };
  const created = await request.post('/api/batch', { data: body });
  expect(created.status(), await created.text()).toBe(201);
  const batch = await created.json();
  const replay = await request.post('/api/batch', { data: body });
  expect(await replay.json()).toMatchObject({ jobId: batch.jobId, reused: true });
  const owner = `e2e-${randomUUID()}`;
  expect((await request.patch('/api/batch', { data: { jobId: batch.jobId, owner, action: 'claim' } })).ok()).toBeTruthy();
  for (const item of batch.items) {
    expect((await request.patch('/api/batch', { data: { itemId: item.id, owner, patch: { status: 'done', projectId: `done-${item.productId}`, compositionId: `composition-${item.productId}` } } })).ok()).toBeTruthy();
  }
  expect((await request.patch('/api/batch', { data: { jobId: batch.jobId, owner, status: 'done' } })).ok()).toBeTruthy();
  const persisted = await (await request.get(`/api/batch?jobId=${batch.jobId}`)).json();
  expect(persisted.job.status).toBe('done');
  expect(persisted.items.every((item: { status: string }) => item.status === 'done')).toBe(true);
  await page.goto('/batch');
  await expect(page.getByRole('heading', { name: '批量制作' })).toBeVisible();
  await page.reload();
  expect((await (await request.get(`/api/batch?jobId=${batch.jobId}`)).json()).job.status).toBe('done');
});

test('结构复刻从真实参考视频得到镜头骨架并保留本地文件', async ({ request, page }) => {
  const response = await request.post('/api/replicate/analyze', { multipart: { file: { name: 'reference.mp4', mimeType: 'video/mp4', buffer: readFileSync(video) } } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const result = await response.json();
  expect(result).toMatchObject({ width: 640, height: 360, modelTierEligible: true });
  expect(result.duration).toBeGreaterThan(1.8);
  expect(result.shots.length).toBeGreaterThan(0);
  expect(result.referenceStructure).toContain('镜');
  const saved = await request.get(result.path);
  expect(saved.ok()).toBeTruthy();
  expect((await saved.body()).byteLength).toBe(readFileSync(video).byteLength);
  await page.goto('/project/clone');
  await expect(page.getByRole('heading', { name: '结构复刻' })).toBeVisible();
});

test('本地合成与发布工具生成可解码成片、封面、图文卡和平台文件', async ({ request, page }, info) => {
  const project = await createProject(request, `Publish-${randomUUID()}`);
  await request.patch(`/api/project/${project.id}`, { data: { shopUrl: 'https://shop.example.test/item' } });
  const upload = await request.post(`/api/project/${project.id}/media`, { headers: { 'Content-Type': 'video/mp4', 'x-file-name': 'publish.mp4' }, data: readFileSync(video) });
  const source = await upload.json();
  const brief = { version: 1, inputMode: 'full_script', projectName: 'Publish fixture', productName: '示例商品', promotionGoal: '', promotionGoalType: 'brand_intro', templateId: 'product_features', templateVersion: 1, fullScript: '展示商品。', hook: '', introduction: '', sellingPoints: ['示例'], proof: '', usageScene: '', audience: '', location: '', offer: '', cta: '', targetDuration: 2, speechRate: 1, editStyle: 'natural', aspectRatio: '16:9', outputQuality: '720p', audioMode: 'original', originalVolume: 0.8, voiceoverVolume: 1, bgmVolume: 0.2, burnSubtitles: false, captionSize: 'medium', captionLanguage: 'zh' };
  const scenes = [{ id: 'scene-1', start: 0, end: 2, label: 'highlight', selected: true }];
  const beats = [{ id: 'beat-1', role: 'hook', text: '展示商品', captionText: '展示商品', estimatedDuration: 2, sceneIds: ['scene-1'] }];
  const timeline = [{ id: 'clip-1', sourceId: source.id, sceneId: 'scene-1', beatId: 'beat-1', start: 0, end: 2, outputStart: 0, outputEnd: 2 }];
  const plan = await (await request.put(`/api/project/${project.id}/edit-plan`, { data: { sourceId: source.id, brief, scenes, beats, timeline, intent: 'ready' } })).json();
  expect((await request.post(`/api/project/${project.id}/edit-plan/${plan.id}/render`, { data: {} })).status()).toBe(202);
  await expect.poll(async () => ((await (await request.get(`/api/project/${project.id}/edit-plan`)).json()).plans.find((item: { id: string }) => item.id === plan.id)?.status), { timeout: 60_000 }).toBe('done');

  const sqlite = new Database(databasePath());
  try {
    sqlite.prepare('insert into scripts (id, project_id, version, style_type, title, total_duration, shots, selected) values (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), project.id, 1, 'custom', '发布标题', 2, JSON.stringify([{ shotId: 1, duration: 2, voiceover: '展示商品细节', description: '商品近景', camera: '静态' }]), 1);
  } finally { sqlite.close(); }

  const cover = await request.post(`/api/project/${project.id}/cover`, { data: { title: '发布封面', frameAt: 0.5 } });
  expect(cover.ok(), await cover.text()).toBeTruthy();
  expect((await request.get((await cover.json()).cover)).ok()).toBeTruthy();
  const carousel = await request.post(`/api/project/${project.id}/carousel`, { data: { width: 320, height: 426 } });
  expect(carousel.ok(), await carousel.text()).toBeTruthy();
  const carouselResult = await carousel.json();
  expect(carouselResult.count).toBeGreaterThan(1);
  expect((await request.get(carouselResult.cards[0])).ok()).toBeTruthy();
  const qr = await request.post(`/api/project/${project.id}/shop-qr`, { data: { platform: 'tiktok', size: 320 } });
  expect(qr.ok(), await qr.text()).toBeTruthy();
  expect((await request.get((await qr.json()).qr)).ok()).toBeTruthy();
  const gate = await request.post(`/api/project/${project.id}/gate`, { data: {} });
  expect(gate.ok(), await gate.text()).toBeTruthy();
  expect((await gate.json()).report.items.length).toBeGreaterThanOrEqual(4);
  const platform = await request.post(`/api/project/${project.id}/export-platform`, { data: { platform: 'xiaohongshu' } });
  expect(platform.ok(), await platform.text()).toBeTruthy();
  const platformResult = await platform.json();
  expect(platformResult).toMatchObject({ success: true, size: '1080x1440' });
  const output = info.outputPath('platform-export.mp4');
  writeFileSync(output, await (await request.get(platformResult.url)).body());
  const metadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { encoding: 'utf8' }));
  expect(metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video')).toMatchObject({ width: 1080, height: 1440 });
  expect(metadata.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio')).toBe(true);
  execFileSync(ffmpeg, ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-']);
  await page.goto(`/project/${project.id}/export`);
  await expect(page.locator('.project-workspace-header')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
});
