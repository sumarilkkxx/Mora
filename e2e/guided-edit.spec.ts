import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import probeInstaller from '@ffprobe-installer/ffprobe';
import { test, expect, type APIRequestContext } from './fixtures';

const ffmpeg = ffmpegPath!;
const ffprobe = probeInstaller.path;
let fixtureRoot = '';
let media = '';

interface GuidedPlanResponse {
  id: string;
  revision: number;
  status: string;
  error?: string | null;
  document: { beats: Array<{ captionText?: string }> };
  composition?: { downloadUrl?: string | null } | null;
}

test.beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'mora-guided-e2e-'));
  media = join(fixtureRoot, 'guided-source.mp4');
  execFileSync(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-movflags', '+faststart', '-y', media,
  ]);
});

test.afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

async function plans(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/project/${id}/edit-plan`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).plans as GuidedPlanResponse[];
}

async function waitForPlan(request: APIRequestContext, id: string, planId: string, expected: RegExp) {
  let plan: GuidedPlanResponse | undefined;
  await expect.poll(async () => {
    plan = (await plans(request, id)).find((item) => item.id === planId);
    return plan?.status;
  }, { timeout: 60_000, intervals: [200, 500] }).toMatch(expected);
  return plan!;
}

test('镜头卡片草稿、取消恢复、局部重渲染和历史版本保持可播放', async ({ request, page }, info) => {
  const created = await request.post('/api/project', { data: { name: `Guided-${randomUUID()}`, workflowType: 'edit', workflowMode: 'guided_edit' } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const upload = await request.post(`/api/project/${id}/media`, {
    headers: { 'Content-Type': 'video/mp4', 'x-file-name': 'guided-source.mp4' },
    data: readFileSync(media),
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const source = await upload.json();
  const brief = {
    version: 1, inputMode: 'full_script', projectName: 'Guided E2E', productName: '示例商品', promotionGoal: '', promotionGoalType: 'brand_intro',
    templateId: 'product_features', templateVersion: 1, fullScript: '第一镜。第二镜。', hook: '', introduction: '', sellingPoints: ['示例事实'], proof: '',
    usageScene: '', audience: '', location: '', offer: '', cta: '', targetDuration: 4, speechRate: 1, editStyle: 'natural', aspectRatio: '16:9',
    outputQuality: '720p', audioMode: 'original', originalVolume: 0.8, voiceoverVolume: 1, bgmVolume: 0.2, burnSubtitles: false,
    captionSize: 'medium', captionLanguage: 'zh',
  };
  const scenes = [
    { id: 'scene-1', start: 0, end: 2, label: 'highlight', selected: true },
    { id: 'scene-2', start: 2, end: 4, label: 'product_detail', selected: true },
  ];
  const beats = [
    { id: 'beat-1', role: 'hook', text: '第一镜', estimatedDuration: 2, sceneIds: ['scene-1'] },
    { id: 'beat-2', role: 'feature', text: '第二镜', estimatedDuration: 2, sceneIds: ['scene-2'] },
  ];
  const timeline = [
    { id: 'clip-1', sourceId: source.id, sceneId: 'scene-1', beatId: 'beat-1', start: 0, end: 2, outputStart: 0, outputEnd: 2 },
    { id: 'clip-2', sourceId: source.id, sceneId: 'scene-2', beatId: 'beat-2', start: 2, end: 4, outputStart: 2, outputEnd: 4 },
  ];
  const draftResponse = await request.put(`/api/project/${id}/edit-plan`, { data: { sourceId: source.id, brief, scenes, beats, timeline, intent: 'draft' } });
  expect(draftResponse.ok(), await draftResponse.text()).toBeTruthy();
  const initialDraft = await draftResponse.json();

  await page.goto(`/project/${id}/edit`);
  await expect(page.getByLabel('只读单轨时间概览')).toBeVisible();
  await expect(page.getByText('镜头 1', { exact: true })).toBeVisible();
  await page.getByLabel('字幕文本').first().fill('只改字幕，不改旁白');
  await expect.poll(async () => (await plans(request, id))[0]?.document?.beats?.[0]?.captionText, { timeout: 10_000 }).toBe('只改字幕，不改旁白');
  await page.reload();
  await expect(page.getByLabel('字幕文本').first()).toHaveValue('只改字幕，不改旁白');

  const apply = await request.put(`/api/project/${id}/edit-plan`, { data: { planId: initialDraft.id, sourceId: source.id, brief, scenes, beats: [{ ...beats[0], captionText: '只改字幕，不改旁白' }, beats[1]], timeline, intent: 'ready' } });
  expect(apply.ok(), await apply.text()).toBeTruthy();
  const ready = await apply.json();
  const start = await request.post(`/api/project/${id}/edit-plan/${ready.id}/render`, { data: {} });
  expect(start.status(), await start.text()).toBe(202);
  const firstDone = await waitForPlan(request, id, ready.id, /^(done|failed)$/);
  expect(firstDone.status, firstDone.error).toBe('done');
  const firstDownload = await request.get(firstDone.composition.downloadUrl);
  expect(firstDownload.ok()).toBeTruthy();
  const firstOutput = info.outputPath('guided-r1.mp4');
  writeFileSync(firstOutput, await firstDownload.body());
  const firstMetadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', firstOutput], { encoding: 'utf8' }));
  expect(firstMetadata.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video')).toMatchObject({ width: 1280, height: 720 });
  expect(firstMetadata.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio')).toBe(true);
  execFileSync(ffmpeg, ['-v', 'error', '-xerror', '-i', firstOutput, '-f', 'null', '-']);

  const secondDraftResponse = await request.put(`/api/project/${id}/edit-plan`, {
    data: { planId: ready.id, sourceId: source.id, brief, scenes, beats: [{ ...beats[0], captionText: '第二版字幕' }, beats[1]], timeline, intent: 'draft' },
  });
  const secondDraft = await secondDraftResponse.json();
  expect(secondDraft).toMatchObject({ revision: 2, status: 'draft' });
  expect((await plans(request, id)).find((plan) => plan.id === ready.id)).toMatchObject({ status: 'done' });

  await page.reload();
  await expect(page.getByLabel('字幕文本').first()).toHaveValue('第二版字幕');
  await expect(page.locator('video')).toBeVisible();
  await expect(page.getByLabel('版本').locator('option')).toHaveCount(2);

  const secondReadyResponse = await request.put(`/api/project/${id}/edit-plan`, {
    data: { planId: secondDraft.id, sourceId: source.id, brief, scenes, beats: [{ ...beats[0], captionText: '第二版字幕' }, beats[1]], timeline, intent: 'ready' },
  });
  const secondReady = await secondReadyResponse.json();
  const secondStart = await request.post(`/api/project/${id}/edit-plan/${secondReady.id}/render`, { data: {} });
  expect(secondStart.status()).toBe(202);
  const cancelled = await request.delete(`/api/project/${id}/edit-plan/${secondReady.id}/render`);
  expect(cancelled.ok(), await cancelled.text()).toBeTruthy();
  await expect.poll(async () => (await plans(request, id)).find((plan) => plan.id === secondReady.id)?.status).toBe('cancelled');

  const resumed = await request.post(`/api/project/${id}/edit-plan/${secondReady.id}/render`, { data: {} });
  expect(resumed.status(), await resumed.text()).toBe(202);
  const secondDone = await waitForPlan(request, id, secondReady.id, /^(done|failed)$/);
  expect(secondDone.status, secondDone.error).toBe('done');
  expect((await plans(request, id)).filter((plan) => plan.status === 'done')).toHaveLength(2);
});
