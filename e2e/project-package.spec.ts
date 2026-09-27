import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { test, expect, type APIRequestContext } from './fixtures';

const ffmpeg = ffmpegPath!;
let fixtureRoot = '';
let media = '';

test.beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'mora-package-e2e-'));
  media = join(fixtureRoot, 'package-source.mp4');
  execFileSync(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-movflags', '+faststart', '-y', media,
  ]);
});

test.afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

function editPlan(sourceId: string, projectName: string) {
  return {
    sourceId,
    brief: {
      version: 1, inputMode: 'full_script', projectName, productName: '示例商品', promotionGoal: '', promotionGoalType: 'brand_intro',
      templateId: 'product_features', templateVersion: 1, fullScript: '第一镜。第二镜。', hook: '', introduction: '', sellingPoints: ['示例事实'], proof: '',
      usageScene: '', audience: '', location: '', offer: '', cta: '', targetDuration: 2, speechRate: 1, editStyle: 'natural', aspectRatio: '16:9',
      outputQuality: '720p', audioMode: 'original', originalVolume: 0.8, voiceoverVolume: 1, bgmVolume: 0.2, burnSubtitles: true,
      captionSize: 'medium', captionLanguage: 'zh',
    },
    scenes: [
      { id: 'scene-1', start: 0, end: 1, label: 'highlight', selected: true },
      { id: 'scene-2', start: 1, end: 2, label: 'product_detail', selected: true },
    ],
    beats: [
      { id: 'beat-1', role: 'hook', text: '第一镜', captionText: '字幕一', estimatedDuration: 1, sceneIds: ['scene-1'] },
      { id: 'beat-2', role: 'feature', text: '第二镜', captionText: '字幕二', estimatedDuration: 1, sceneIds: ['scene-2'] },
    ],
    timeline: [
      { id: 'clip-1', sourceId, sceneId: 'scene-1', beatId: 'beat-1', start: 0, end: 1, outputStart: 0, outputEnd: 1 },
      { id: 'clip-2', sourceId, sceneId: 'scene-2', beatId: 'beat-2', start: 1, end: 2, outputStart: 1, outputEnd: 2 },
    ],
    intent: 'ready',
  };
}

async function waitForPlan(request: APIRequestContext, projectId: string, planId: string) {
  let plan: { status: string; error?: string; composition?: { outputUrl?: string } } | undefined;
  await expect.poll(async () => {
    const response = await request.get(`/api/project/${projectId}/edit-plan`);
    expect(response.ok(), await response.text()).toBeTruthy();
    plan = (await response.json()).plans.find((item: { id: string }) => item.id === planId);
    return plan?.status;
  }, { timeout: 60_000, intervals: [250, 500] }).toBe('done');
  return plan!;
}

test('用户可导出、删除并导入自包含项目包，恢复预览、重渲染和再次导出', async ({ request, page }, info) => {
  const name = `Package-${randomUUID()}`;
  const created = await request.post('/api/project', { data: { name, workflowType: 'edit', workflowMode: 'guided_edit' } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const upload = await request.post(`/api/project/${id}/media`, {
    headers: { 'Content-Type': 'video/mp4', 'x-file-name': 'package-source.mp4' },
    data: readFileSync(media),
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const source = await upload.json();
  const planResponse = await request.put(`/api/project/${id}/edit-plan`, { data: editPlan(source.id, name) });
  expect(planResponse.ok(), await planResponse.text()).toBeTruthy();
  const plan = await planResponse.json();
  const render = await request.post(`/api/project/${id}/edit-plan/${plan.id}/render`, { data: {} });
  expect(render.status(), await render.text()).toBe(202);
  const finished = await waitForPlan(request, id, plan.id);
  expect(finished.composition?.outputUrl).toBeTruthy();

  // Compile the package route before the page starts polling /api/tasks. Under
  // next dev, compiling both routes at once can intermittently abort the poll.
  const warmedPackageRoute = await request.get(`/api/project/${id}/package?estimate=1`);
  expect(warmedPackageRoute.ok(), await warmedPackageRoute.text()).toBeTruthy();

  await page.goto('/projects');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: `备份项目包：${name}` }).click();
  const download = await downloadPromise;
  const packagePath = info.outputPath('round-trip.mora');
  await download.saveAs(packagePath);
  expect(readFileSync(packagePath).byteLength).toBeGreaterThan(readFileSync(media).byteLength);

  const removed = await request.delete(`/api/project/${id}?permanent=1`);
  expect(removed.ok(), await removed.text()).toBeTruthy();
  await page.reload();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);

  await page.locator('input[type=file][accept*=".mora"]').setInputFiles(packagePath);
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 });
  const restoredMediaResponse = await request.get(`/api/project/${id}/media`);
  expect(restoredMediaResponse.ok(), await restoredMediaResponse.text()).toBeTruthy();
  const restoredMedia = await restoredMediaResponse.json();
  expect(restoredMedia.sources).toHaveLength(1);
  const preview = await request.get(restoredMedia.sources[0].url);
  expect(preview.ok()).toBeTruthy();
  expect((await preview.body()).byteLength).toBe(readFileSync(media).byteLength);
  const restoredPlans = await request.get(`/api/project/${id}/edit-plan`);
  const restoredPlan = (await restoredPlans.json()).plans.find((item: { id: string }) => item.id === plan.id);
  expect(restoredPlan.composition.outputUrl).toBeTruthy();
  expect((await request.get(restoredPlan.composition.outputUrl)).ok()).toBeTruthy();

  const revised = await request.put(`/api/project/${id}/edit-plan`, { data: { ...editPlan(source.id, name), planId: plan.id } });
  expect(revised.ok(), await revised.text()).toBeTruthy();
  const revisedPlan = await revised.json();
  const rerender = await request.post(`/api/project/${id}/edit-plan/${revisedPlan.id}/render`, { data: {} });
  expect(rerender.status(), await rerender.text()).toBe(202);
  await waitForPlan(request, id, revisedPlan.id);
  const exportedAgain = await request.get(`/api/project/${id}/package`);
  expect(exportedAgain.ok(), await exportedAgain.text()).toBeTruthy();
  expect(exportedAgain.headers()['content-type']).toBe('application/vnd.mora.project+zip');
});
