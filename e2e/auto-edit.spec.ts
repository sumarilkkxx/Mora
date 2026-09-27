import { test, expect, type APIRequestContext } from './fixtures';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { startProvider } from './helpers/provider';
import ffmpegPath from 'ffmpeg-static';
import probeInstaller from '@ffprobe-installer/ffprobe';
const ffmpeg = ffmpegPath!;
const ffprobe = probeInstaller.path;
let fixtureRoot: string;
let media: string;
const brief = { instruction: '展示护肤步骤，不编造产品功效', target: 15, aspect: '9:16', audio: 'voiceover', style: 'concise', captions: true, locale: 'zh', promotion: { subject: '护肤步骤', audience: '', sellingPoints: '', action: '了解更多' } };

test.beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'mora-e2e-fixture-'));
  media = join(fixtureRoot, 'source.mp4');
  execFileSync(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24:duration=5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', media,
  ]);
});

test.afterAll(() => {
  const safeTmp = realpathSync(tmpdir());
  const safeRoot = realpathSync(fixtureRoot);
  if (dirname(safeRoot) !== safeTmp || !basename(safeRoot).startsWith('mora-e2e-fixture-')) {
    throw new Error(`Refusing to remove unexpected E2E fixture directory: ${safeRoot}`);
  }
  rmSync(safeRoot, { recursive: true });
});

async function uploaded(request: APIRequestContext, file = media) {
  const created = await request.post('/api/project', { data: { name: `E2E-${randomUUID()}`, workflowType: 'edit' } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const upload = await request.post(`/api/project/${id}/media`, { headers: { 'Content-Type': 'video/mp4', 'x-file-name': 'synthetic.mp4' }, data: readFileSync(file) });
  expect(upload.status(), await upload.text()).toBe(201);
  const source = await upload.json();
  expect(source.sizeBytes, "上传必须保留完整文件，不能静默截断").toBe(readFileSync(file).length);
  return { id, source, endpoint: `/api/project/${id}/auto-edit` };
}
async function settled(request: APIRequestContext, endpoint: string, runId: string) {
  let run;
  await expect.poll(async () => {
    const response = await request.get(endpoint);
    expect(response.ok()).toBeTruthy();
    run = (await response.json()).runs.find((item: { id: string }) => item.id === runId);
    return run?.status;
  }, { timeout: 100_000, intervals: [500, 1000] }).toMatch(/^(waiting_input|done|needs_review|failed|cancelled|interrupted)$/);
  expect(run).toBeTruthy();
  return run!;
}

test('合成素材上传→分析→文案确认→选段→生成旁白→合成→下载播放', async ({ request, page }, info) => {
  const file = media;
  // Tone is a deterministic transport fixture, never counted as real speech quality.
  const tone = info.outputPath('tts-fixture.mp3');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-y', tone]);
  const inputMeta = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
  const provider = await startProvider(tone, Math.min(5, Number(inputMeta.format.duration)));
  try {
    const { id, source, endpoint } = await uploaded(request, file);
    const returned = await request.get(source.url);
    expect(returned.ok()).toBeTruthy();
    expect(createHash('sha256').update(await returned.body()).digest('hex')).toBe(createHash('sha256').update(readFileSync(file)).digest('hex'));
    expect(source.hasAudio).toBe(false);
    const started = Date.now();
    const body = { action: 'analyze', sourceId: source.id, requestId: randomUUID(), brief, credentials: provider.credentials };
    const responses = await Promise.all([request.post(endpoint, { data: body }), request.post(endpoint, { data: body })]);
    for (const response of responses) expect(response.status()).toBe(202);
    const first = await responses[0].json();
    expect((await responses[1].json()).runId).toBe(first.runId);
    const analyzed = await settled(request, endpoint, first.runId);
    expect(analyzed.status, analyzed.error).toBe('waiting_input');
    expect(analyzed.checkpoint.promotionCandidates).toHaveLength(3);
    const count = provider.calls.length;
    const approved = await request.post(endpoint, { data: { action: 'approve-copy', runId: first.runId, requestId: randomUUID(), copy: analyzed.checkpoint.promotionCopy, credentials: provider.credentials } });
    expect(approved.status()).toBe(202);
    const candidates = await settled(request, endpoint, (await approved.json()).runId);
    expect(candidates.status, candidates.error).toBe('waiting_input');
    expect(candidates.checkpoint.candidates.length).toBeGreaterThan(0);
    expect(provider.calls.length).toBe(count);
    const render = await request.post(endpoint, { data: { action: 'manual', runId: candidates.id, requestId: randomUUID(), plan: candidates.checkpoint.candidates[0], credentials: provider.credentials } });
    expect(render.status(), await render.text()).toBe(202);
    const finished = await settled(request, endpoint, (await render.json()).runId);
    expect(['done', 'needs_review'], finished.error).toContain(finished.status);
    expect(finished.checkpoint.checks.technical).toBe(true);
    expect(provider.calls).toContain('tts');
    const download = await request.get(`${finished.url}?download=1`);
    expect(download.ok()).toBeTruthy();
    const output = info.outputPath('result.mp4');
    writeFileSync(output, await download.body());
    const metadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { encoding: 'utf8' }));
    expect(metadata.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio')).toBe(true);
    expect(metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video')).toMatchObject({ width: 720, height: 1280 });
    expect(Number(metadata.format.duration)).toBeLessThanOrEqual(15.2);
    execFileSync(ffmpeg, ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-']);
    const projects = await (await request.get('/api/project')).json();
    const savedProject = projects.find((project: { id: string }) => project.id === id);
    expect(savedProject.continuation).toMatchObject({ mode: 'auto_edit', stage: finished.stage });
    expect(savedProject.continuation.href).toBe(`/project/${id}/auto-edit?run=${encodeURIComponent(finished.id)}`);

    await page.goto('/projects');
    await page.waitForLoadState('networkidle');
    const resume = page.locator(`a[href^="/project/${id}/auto-edit"]`).first();
    await expect(resume).toHaveAttribute('href', savedProject.continuation.href);
    await resume.click();
    await expect(page).toHaveURL(new RegExp(`/project/${id}/auto-edit\\?run=`));
    await expect(page.locator('.project-workspace-header')).toHaveCount(1);
    const video = page.locator('video').filter({ visible: true }).last();
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => new URL(element.currentSrc).pathname)).toBe(finished.url);
    await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; element.currentTime = 0; await element.play(); });
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.2);
    await video.evaluate((element: HTMLVideoElement) => element.pause());
    await page.reload();
    await expect(page.locator('.project-workspace-header')).toHaveCount(1);
    await expect(page.locator('video').filter({ visible: true }).last()).toBeVisible();
    await info.attach('case-result', { body: JSON.stringify({ sourceId: 'synthetic', category: 'hermetic', status: finished.status, elapsedMs: Date.now() - started, checks: finished.checkpoint.checks, inputBytes: source.sizeBytes, outputBytes: (await download.body()).length }), contentType: 'application/json' });
    await info.attach('media-metadata', { body: JSON.stringify(metadata), contentType: 'application/json' });
    await info.attach('provider-call-types', { body: JSON.stringify(provider.calls), contentType: 'application/json' });
  } finally { await provider.close(); }
});

for (const fault of ['invalid-json', '429'] as const) {
  test(`模型 ${fault} 失败后可恢复，重复 retry 只领取一次`, async ({ request }, info) => {
    const provider = await startProvider(info.outputPath('unused.mp3'));
    try {
      const { source, endpoint } = await uploaded(request);
      provider.setFault(fault);
      const response = await request.post(endpoint, { data: { action: 'analyze', sourceId: source.id, requestId: randomUUID(), brief, credentials: provider.credentials } });
      expect(response.status()).toBe(202);
      const { runId } = await response.json();
      const failed = await settled(request, endpoint, runId);
      expect(failed.status).toBe('failed');
      expect(failed.url).toBeNull();
      provider.setFault('none');
      const retries = await Promise.all([1, 2].map(() => request.post(endpoint, { data: { action: 'retry', runId, credentials: provider.credentials } })));
      // A late retry may see the already-running task and return 400; never a second run.
      for (const retry of retries) expect([202, 400]).toContain(retry.status());
      expect(retries.some(retry => retry.status() === 202)).toBe(true);
      const recovered = await settled(request, endpoint, runId);
      expect(recovered.status, recovered.error).toBe('waiting_input');
      expect(recovered.attempt).toBe(2);
      const runs = (await (await request.get(endpoint)).json()).runs;
      expect(runs).toHaveLength(1);
      await info.attach('provider-call-types', { body: JSON.stringify(provider.calls), contentType: 'application/json' });
    } finally { await provider.close(); }
  });
}

test('无音轨视频选择保留原声时明确失败，不请求模型', async ({ request }, info) => {
  const provider = await startProvider(info.outputPath('unused.mp3'));
  try {
    const { source, endpoint } = await uploaded(request);
    const response = await request.post(endpoint, { data: { action: 'analyze', sourceId: source.id, requestId: randomUUID(), brief: { ...brief, audio: 'original' }, credentials: provider.credentials } });
    expect(response.status()).toBe(202);
    const run = await settled(request, endpoint, (await response.json()).runId);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('Source has no audio');
    expect(run.url).toBeNull();
    expect(provider.calls).toHaveLength(0);
  } finally { await provider.close(); }
});

test('损坏的 MP4 被拒绝且不留下可选素材', async ({ request }) => {
  const project = await (await request.post('/api/project', { data: { name: 'corrupt-upload', workflowType: 'edit' } })).json();
  const endpoint = `/api/project/${project.id}/media`;
  const upload = await request.post(endpoint, { headers: { 'Content-Type': 'video/mp4', 'x-file-name': 'broken.mp4' }, data: Buffer.from('not a video') });
  expect(upload.status()).toBe(422);
  expect((await (await request.get(endpoint)).json()).sources).toEqual([]);
});
