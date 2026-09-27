import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import probeInstaller from '@ffprobe-installer/ffprobe';
import { test, expect } from './fixtures';

const ffmpeg = ffmpegPath!;
const ffprobe = probeInstaller.path;
let sourceFile: string;
let sourceUrl: string;
let outputUrl: string;

test.beforeAll(() => {
  const state = JSON.parse(readFileSync(join(process.cwd(), 'test-results', 'e2e-server-state.json'), 'utf8')) as { root: string };
  const uploads = join(state.root, 'data', 'uploads', 'media-runtime');
  const output = join(state.root, 'data', 'output', 'media-runtime');
  mkdirSync(uploads, { recursive: true });
  mkdirSync(output, { recursive: true });
  sourceFile = join(uploads, '素材 with audio.mp4');
  execFileSync(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-shortest',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-movflags', '+faststart', '-y', sourceFile,
  ]);
  const outputFile = join(output, '成片 with audio.mp4');
  copyFileSync(sourceFile, outputFile);
  sourceUrl = `/api/files/media-runtime/${encodeURIComponent('素材 with audio.mp4')}`;
  outputUrl = `/api/output/media-runtime/${encodeURIComponent('成片 with audio.mp4')}`;
});

test('Media Runtime 支持完整下载、并发 Range、取消、seek 与重复打开', async ({ request, page }) => {
  const expected = readFileSync(sourceFile);
  for (const url of [sourceUrl, outputUrl]) {
    const full = await request.get(url);
    expect(full.status()).toBe(200);
    expect(full.headers()['accept-ranges']).toBe('bytes');
    expect(createHash('sha256').update(await full.body()).digest('hex')).toBe(createHash('sha256').update(expected).digest('hex'));

    const ranges = await Promise.all([
      request.get(url, { headers: { Range: 'bytes=0-1023' } }),
      request.get(url, { headers: { Range: 'bytes=4096-8191' } }),
      request.get(url, { headers: { Range: 'bytes=-2048' } }),
    ]);
    expect(ranges.map(response => response.status())).toEqual([206, 206, 206]);
    expect(await ranges[0].body()).toEqual(expected.subarray(0, 1024));
    expect(await ranges[1].body()).toEqual(expected.subarray(4096, 8192));
    expect(await ranges[2].body()).toEqual(expected.subarray(-2048));
    const multipart = await request.get(url, { headers: { Range: 'bytes=0-1,4-5' } });
    expect(multipart.status()).toBe(416);
    expect(multipart.headers()['content-range']).toBe(`bytes */${expected.length}`);
  }

  await page.goto('/start');
  const result = await page.evaluate(async ({ source, output }) => {
    async function cancelAfterFirstChunk(url: string) {
      const response = await fetch(url, { headers: { Range: 'bytes=0-' } });
      const reader = response.body!.getReader();
      const first = await reader.read();
      await reader.cancel('seek replaced');
      return { status: response.status, bytes: first.value?.byteLength ?? 0 };
    }
    const cancellations = await Promise.all(Array.from({ length: 8 }, (_, index) => cancelAfterFirstChunk(index % 2 ? source : output)));

    async function openAndSeek(url: string, seekTo: number) {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.src = url;
      document.body.appendChild(video);
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(new Error(`media error ${video.error?.code ?? 'unknown'}`)), { once: true });
      });
      video.currentTime = Math.min(seekTo, Math.max(0, video.duration - 0.2));
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('seeked', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(new Error(`seek error ${video.error?.code ?? 'unknown'}`)), { once: true });
      });
      const state = { duration: video.duration, currentTime: video.currentTime, readyState: video.readyState };
      video.removeAttribute('src');
      video.load();
      video.remove();
      return state;
    }

    return {
      cancellations,
      first: await openAndSeek(output, 3.5),
      reopened: await openAndSeek(output, 0.5),
    };
  }, { source: sourceUrl, output: outputUrl });

  expect(result.cancellations.every(item => item.status === 206 && item.bytes > 0)).toBe(true);
  expect(result.first.currentTime).toBeGreaterThan(3);
  expect(result.reopened.currentTime).toBeGreaterThan(0.3);
  expect(result.first.readyState).toBeGreaterThanOrEqual(1);

  const metadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', sourceFile], { encoding: 'utf8' }));
  expect(metadata.streams.some((stream: { codec_type: string }) => stream.codec_type === 'video')).toBe(true);
  expect(metadata.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio')).toBe(true);
  execFileSync(ffmpeg, ['-v', 'error', '-xerror', '-i', sourceFile, '-f', 'null', '-']);
});
