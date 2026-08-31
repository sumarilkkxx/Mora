import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenRouterProvider } from '@/lib/providers/openrouter'

const provider = () => new OpenRouterProvider({
  name: 'openrouter',
  apiKey: 'test-key',
  baseUrl: 'https://openrouter.ai/api/v1',
})

afterEach(() => vi.restoreAllMocks())

describe('OpenRouterProvider', () => {
  it('loads image models and exposes edit support only for models accepting image input', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'openai/gpt-image-2', name: 'GPT Image 2', architecture: { input_modalities: ['text', 'image'] } },
        { id: 'vendor/text-only-image', name: 'Text Image', architecture: { input_modalities: ['text'] } },
      ],
    }), { status: 200 }))

    const models = await provider().listModels('image')
    expect(models).toHaveLength(2)
    expect(models[0]?.modes).toEqual(['text-to-image', 'image-to-image'])
    expect(models[1]?.modes).toEqual(['text-to-image'])
  })

  it('generates an image through the unified image endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      created: 123,
      data: [{ b64_json: 'aGVsbG8=', media_type: 'image/png' }],
      usage: { cost: 0.04 },
    }), { status: 200 }))

    const result = await provider().generateImage({
      modelId: 'openai/gpt-image-2',
      mode: 'image-to-image',
      prompt: 'polished product photo',
      width: 1080,
      height: 1920,
      referenceImageUrl: 'data:image/png;base64,cmVm',
    })

    expect(result.imageUrls[0]).toBe('data:image/png;base64,aGVsbG8=')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/images',
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.size).toBe('1080x1920')
    expect(body.input_references[0].image_url.url).toBe('data:image/png;base64,cmVm')
  })

  it('loads video models from the dedicated catalogue', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'bytedance/seedance-2.0', name: 'ByteDance: Seedance 2.0', supported_resolutions: ['720p', '1080p'], generate_audio: true }],
    }), { status: 200 }))

    const models = await provider().listModels('video')
    expect(models).toEqual([expect.objectContaining({
      id: 'bytedance/seedance-2.0',
      mediaType: 'video',
      provider: 'openrouter',
      modes: ['text-to-video', 'image-to-video'],
      supportsAudio: true,
    })])
  })

  it('submits and polls an OpenRouter video job', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'job-1', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'job-1', model: 'google/veo-3.1', status: 'completed',
        unsigned_urls: ['https://openrouter.ai/api/v1/videos/job-1/content?index=0'],
      }), { status: 200 }))

    const instance = provider()
    const submitted = await instance.submitVideoTask({
      modelId: 'bytedance/seedance-2.0', mode: 'image-to-video', prompt: 'product turntable',
      width: 1080, height: 1920, duration: 15, firstFrameUrl: 'https://example.com/first.png',
      referenceImageUrls: ['https://example.com/reference.png'], audioEnabled: true, seed: 42,
      fps: 60, motionStrength: 0.8, negativePrompt: 'blurred',
    })
    expect(submitted).toEqual({ taskId: 'job-1', modelId: 'bytedance/seedance-2.0' })
    const submitBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(submitBody).toMatchObject({
      model: 'bytedance/seedance-2.0', resolution: '1080p', aspect_ratio: '9:16',
      duration: 15, generate_audio: true, seed: 42,
    })
    expect(submitBody.frame_images[0].frame_type).toBe('first_frame')
    expect(submitBody.input_references[0].image_url.url).toBe('https://example.com/reference.png')
    expect(submitBody).not.toHaveProperty('fps')
    expect(submitBody).not.toHaveProperty('motionStrength')
    expect(submitBody).not.toHaveProperty('negativePrompt')

    const status = await instance.getTaskStatus('job-1')
    expect(status.status).toBe('completed')
    expect(status.result).toEqual(expect.objectContaining({ videoUrls: [expect.stringContaining('/content?index=0')] }))
  })

  it('maps 480p dimensions without silently upgrading them to 720p', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'job-480', status: 'pending' }), { status: 202 })
    )
    await provider().submitVideoTask({
      modelId: 'bytedance/seedance-2.0', mode: 'text-to-video', prompt: 'test', width: 480, height: 854,
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.resolution).toBe('480p')
    expect(body.aspect_ratio).toBe('9:16')
  })

  it('uses the authenticated content endpoint when a completed job omits unsigned URLs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'job-without-urls', model: 'bytedance/seedance-2.0', status: 'completed',
    }), { status: 200 }))

    const status = await provider().getTaskStatus('job-without-urls')

    expect(status.status).toBe('completed')
    expect(status.result).toEqual(expect.objectContaining({
      videoUrls: ['https://openrouter.ai/api/v1/videos/job-without-urls/content?index=0'],
    }))
  })

  it('normalizes relative completed-video URLs against the configured API base URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'job-relative', status: 'completed',
      unsigned_urls: ['videos/job-relative/content?index=0'],
    }), { status: 200 }))

    const status = await provider().getTaskStatus('job-relative')

    expect(status.result).toEqual(expect.objectContaining({
      videoUrls: ['https://openrouter.ai/api/v1/videos/job-relative/content?index=0'],
    }))
  })
})
