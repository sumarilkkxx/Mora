import { afterEach, describe, expect, it, vi } from 'vitest'
import { AtlasCloudProvider } from '@/lib/providers/atlas-cloud'
import { ATLAS_VIDEO_FAMILIES } from '@/lib/atlas-video-models'
import { createProvider } from '@/lib/providers'

const provider = () => new AtlasCloudProvider({
  name: 'atlas-cloud',
  apiKey: 'apikey-test',
  baseUrl: 'https://api.atlascloud.ai/api/v1',
})

afterEach(() => vi.restoreAllMocks())

describe('AtlasCloudProvider', () => {
  it('is registered as a real provider and always includes the verified model families', async () => {
    expect(createProvider({ name: 'atlas-cloud', apiKey: 'x', baseUrl: '' })).toBeInstanceOf(AtlasCloudProvider)
    const models = await provider().listModels('video')
    expect(models.length).toBeGreaterThanOrEqual(ATLAS_VIDEO_FAMILIES.length)
    expect(models).toContainEqual(expect.objectContaining({
      id: 'bytedance/seedance-2.0-mini',
      provider: 'atlas-cloud',
      mediaType: 'video',
      supportsAudio: true,
    }))
    expect(await provider().listModels('image')).toEqual([])
  })

  it('submits the exact Atlas reference-to-video schema without hidden overrides', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 200, data: { id: 'pred-1', status: 'processing' } }), { status: 200 })
    )
    const submitted = await provider().submitVideoTask({
      modelId: 'bytedance/seedance-2.0-mini/reference-to-video',
      mode: 'video-to-video',
      prompt: 'image 1 becomes a product film',
      width: 720,
      height: 1280,
      duration: 15,
      referenceImageUrls: ['data:image/webp;base64,AAAA'],
      referenceVideoUrls: ['https://example.com/reference.mp4'],
      referenceAudioUrls: ['https://example.com/voice.wav'],
      audioEnabled: true,
      seed: 42,
      fps: 60,
      motionStrength: 0.9,
      negativePrompt: 'blur',
      extra: { bitrate_mode: 'high', watermark: false, model: 'bytedance/seedance-2.5/reference-to-video' },
    })
    expect(submitted).toEqual({ taskId: 'pred-1', modelId: 'bytedance/seedance-2.0-mini/reference-to-video' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.atlascloud.ai/api/v1/model/generateVideo', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      model: 'bytedance/seedance-2.0-mini/reference-to-video',
      duration: 15,
      resolution: '720p',
      ratio: '9:16',
      reference_images: ['data:image/webp;base64,AAAA'],
      reference_videos: ['https://example.com/reference.mp4'],
      reference_audios: ['https://example.com/voice.wav'],
      generate_audio: true,
      seed: 42,
      bitrate_mode: 'high',
      watermark: false,
    })
    expect(body).not.toHaveProperty('fps')
    expect(body).not.toHaveProperty('motionStrength')
    expect(body).not.toHaveProperty('negativePrompt')
  })

  it('uses image and last_image only on the image-to-video endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 'pred-i2v' } }), { status: 200 })
    )
    await provider().submitVideoTask({
      modelId: 'bytedance/seedance-2.0/image-to-video',
      mode: 'image-to-video',
      prompt: 'animate product',
      width: 1920,
      height: 1080,
      duration: 8,
      firstFrameUrl: 'data:image/png;base64,AAAA',
      lastFrameUrl: 'data:image/png;base64,BBBB',
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({ resolution: '1080p', ratio: 'adaptive', image: 'data:image/png;base64,AAAA', last_image: 'data:image/png;base64,BBBB' })
    expect(body).not.toHaveProperty('reference_images')
  })

  it('submits Seedance 2.5 native 1080p without attaching an SR product', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 'pred-native-1080' } }), { status: 200 })
    )
    await provider().submitVideoTask({
      modelId: 'bytedance/seedance-2.5/image-to-video',
      mode: 'image-to-video',
      prompt: 'animate product',
      width: 1080,
      height: 1920,
      duration: 8,
      firstFrameUrl: 'data:image/png;base64,AAAA',
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.resolution).toBe('1080p')
    expect(body.resolution).not.toMatch(/-sr|-esr/i)
  })

  it('maps resolution by model capability and blocks unsupported duration/mode before the paid POST', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ code: 200, data: { id: 'pred-map', status: 'processing' } }), { status: 200 })
    )
    const mini = { modelId: 'bytedance/seedance-2.0-mini/reference-to-video', mode: 'video-to-video' as const, prompt: 'x' }
    await provider().submitVideoTask({ ...mini, width: 1080, height: 1920, duration: 15 })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).resolution).toBe('720p')
    fetchMock.mockClear()
    await expect(provider().submitVideoTask({ ...mini, width: 720, height: 1280, duration: 30 })).rejects.toMatchObject({ code: 'UNSUPPORTED_DURATION' })
    const routed = await provider().submitVideoTask({ modelId: 'bytedance/seedance-2.5/text-to-video', mode: 'text-to-video', prompt: 'x', firstFrameUrl: 'data:image/png;base64,AA' })
    expect(routed.modelId).toBe('bytedance/seedance-2.5/image-to-video')
  })

  it('maps Atlas prediction status and output URLs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 200,
      data: { id: 'pred-2', model: 'bytedance/seedance-2.5/reference-to-video', status: 'succeeded', outputs: [{ download_url: 'https://cdn.example/video.mp4' }], completion_tokens: 1234 },
    }), { status: 200 }))
    const status = await provider().getTaskStatus('pred-2')
    expect(status.status).toBe('completed')
    expect(status.result).toEqual(expect.objectContaining({ videoUrls: ['https://cdn.example/video.mp4'] }))
    expect(status.extra).toMatchObject({ completionTokens: 1234 })
  })
})
