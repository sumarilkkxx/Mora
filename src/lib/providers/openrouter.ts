/**
 * OpenRouter unified image + video API provider.
 * Docs:
 * - https://openrouter.ai/docs/guides/overview/multimodal/image-generation
 * - https://openrouter.ai/docs/guides/overview/multimodal/video-generation
 */

import { BaseProvider, ProviderError } from './base'
import type {
  ImageOptions,
  ImageResult,
  MediaType,
  Model,
  ProviderConfig,
  TaskStatus,
  TaskStatusEnum,
  VideoOptions,
  VideoResult,
} from './types'
import { normalizeImageDataUri } from '../image-format'

interface OpenRouterImageModelsResponse {
  data?: Array<{
    id?: string
    name?: string
    description?: string
    architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  }>
}

interface OpenRouterImageResponse {
  created?: number
  data?: Array<{ b64_json?: string; media_type?: string; url?: string }>
  usage?: Record<string, unknown>
}

interface OpenRouterVideoModelsResponse {
  data?: Array<{
    id?: string
    name?: string
    description?: string
    supported_durations?: number[]
    supported_resolutions?: string[]
    supported_aspect_ratios?: string[]
    supported_sizes?: string[]
    generate_audio?: boolean
    pricing_skus?: Record<string, string>
    allowed_passthrough_parameters?: string[]
  }>
}

interface OpenRouterVideoJob {
  id?: string
  generation_id?: string | null
  model?: string | null
  polling_url?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired'
  unsigned_urls?: string[]
  error?: string | { message?: string; code?: string }
  usage?: { cost?: number; is_byok?: boolean }
}

function toAspectRatio(width?: number, height?: number): string | undefined {
  if (!width || !height) return undefined
  if (width === height) return '1:1'
  return width > height ? '16:9' : '9:16'
}

function toResolution(width?: number, height?: number): string | undefined {
  const longEdge = Math.max(width ?? 0, height ?? 0)
  if (!longEdge) return undefined
  if (longEdge >= 1900) return '1080p'
  if (longEdge >= 1000) return '720p'
  return '480p'
}

export class OpenRouterProvider extends BaseProvider {
  readonly name = 'openrouter'
  readonly displayName = 'OpenRouter'

  constructor(config: ProviderConfig) {
    super({ ...config, baseUrl: config.baseUrl || 'https://openrouter.ai/api/v1' })
  }

  async generateImage(options: ImageOptions): Promise<ImageResult> {
    const references = [
      ...(options.referenceImageUrls ?? []),
      ...(options.referenceImageUrl ? [options.referenceImageUrl] : []),
    ]
    const startedAt = Date.now()
    const response = await this.request<OpenRouterImageResponse>('/images', {
      method: 'POST',
      timeout: 180000,
      body: {
        model: options.modelId,
        prompt: options.prompt,
        n: options.count ?? 1,
        ...(options.width && options.height ? { size: `${options.width}x${options.height}` } : {}),
        ...(options.seed != null ? { seed: options.seed } : {}),
        ...(references.length
          ? {
              input_references: references.map((url) => ({
                type: 'image_url',
                image_url: { url },
              })),
            }
          : {}),
        ...options.extra,
      },
    })

    const imageUrls = (response.data ?? []).flatMap((image) => {
      if (image.url) return [image.url]
      if (!image.b64_json) return []
      return [normalizeImageDataUri(`data:${image.media_type || 'image/png'};base64,${image.b64_json}`)]
    })
    if (imageUrls.length === 0) {
      throw new ProviderError('OpenRouter 已完成请求，但没有返回图片', 'NO_RESULT', this.name)
    }

    return {
      taskId: `openrouter-${response.created ?? Date.now()}`,
      imageUrls,
      duration: Date.now() - startedAt,
      modelId: options.modelId,
      seed: options.seed,
      extra: { usage: response.usage },
    }
  }

  async submitVideoTask(options: VideoOptions): Promise<{ taskId: string; modelId: string }> {
    const frameImages = [
      ...(options.firstFrameUrl
        ? [{ type: 'image_url', image_url: { url: options.firstFrameUrl }, frame_type: 'first_frame' }]
        : []),
      ...(options.lastFrameUrl
        ? [{ type: 'image_url', image_url: { url: options.lastFrameUrl }, frame_type: 'last_frame' }]
        : []),
    ]
    const referenceImages = options.referenceImageUrls ?? []
    const created = await this.request<OpenRouterVideoJob>('/videos', {
      method: 'POST',
      timeout: 60000,
      body: {
        model: options.modelId,
        prompt: options.prompt,
        ...(options.duration != null ? { duration: options.duration } : {}),
        ...(toResolution(options.width, options.height) ? { resolution: toResolution(options.width, options.height) } : {}),
        ...(toAspectRatio(options.width, options.height) ? { aspect_ratio: toAspectRatio(options.width, options.height) } : {}),
        ...(frameImages.length ? { frame_images: frameImages } : {}),
        ...(referenceImages.length
          ? {
              input_references: referenceImages.map((url) => ({
                type: 'image_url',
                image_url: { url },
              })),
            }
          : {}),
        ...(options.audioEnabled != null ? { generate_audio: options.audioEnabled } : {}),
        ...(options.seed != null ? { seed: options.seed } : {}),
        ...options.extra,
      },
    })
    if (!created.id) {
      throw new ProviderError('OpenRouter 未返回视频任务 ID', 'NO_TASK_ID', this.name)
    }
    return { taskId: created.id, modelId: options.modelId }
  }

  async generateVideo(options: VideoOptions): Promise<VideoResult> {
    const { taskId } = await this.submitVideoTask(options)
    const finalStatus = await this.pollTaskStatus(taskId, { interval: 30000 })
    const result = this.requireResult(finalStatus.result) as VideoResult
    result.modelId = options.modelId
    return result
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const job = await this.request<OpenRouterVideoJob>(`/videos/${encodeURIComponent(taskId)}`)
    const status = this.mapVideoStatus(job.status)
    const error = typeof job.error === 'string' ? job.error : job.error?.message
    const taskStatus: TaskStatus = {
      taskId: job.id || taskId,
      status,
      error,
      errorCode: typeof job.error === 'object' ? job.error.code : undefined,
      extra: { pollingUrl: job.polling_url, generationId: job.generation_id, usage: job.usage },
    }
    if (status === 'completed') {
      const urls = (job.unsigned_urls?.length
        ? job.unsigned_urls
        : [`${this.config.baseUrl.replace(/\/$/, '')}/videos/${encodeURIComponent(taskId)}/content?index=0`]
      ).map((url) => new URL(url, `${this.config.baseUrl.replace(/\/$/, '')}/`).toString())
      taskStatus.result = {
        taskId: job.id || taskId,
        videoUrls: urls,
        modelId: job.model || '',
        extra: { usage: job.usage },
      }
    }
    return taskStatus
  }

  private mapVideoStatus(status: OpenRouterVideoJob['status']): TaskStatusEnum {
    switch (status) {
      case 'pending': return 'pending'
      case 'in_progress': return 'processing'
      case 'completed': return 'completed'
      case 'cancelled': return 'cancelled'
      case 'failed':
      case 'expired': return 'failed'
      default: return 'processing'
    }
  }

  async listModels(mediaType?: MediaType): Promise<Model[]> {
    const loadImages = async (): Promise<Model[]> => {
      const response = await this.request<OpenRouterImageModelsResponse>('/images/models')
      return (response.data ?? []).flatMap((model) => {
        if (!model.id) return []
        const acceptsImages = model.architecture?.input_modalities?.includes('image') ?? false
        return [{
          id: model.id,
          name: model.name || model.id,
          description: model.description,
          modes: acceptsImages ? ['text-to-image', 'image-to-image'] : ['text-to-image'],
          mediaType: 'image',
          provider: this.name,
        } satisfies Model]
      })
    }
    const loadVideos = async (): Promise<Model[]> => {
      const response = await this.request<OpenRouterVideoModelsResponse>('/videos/models')
      return (response.data ?? []).flatMap((model) => {
      if (!model.id) return []
      return [{
        id: model.id,
        name: model.name || model.id,
        description: model.description,
        modes: ['text-to-video', 'image-to-video'],
        mediaType: 'video',
        provider: this.name,
        supportsAudio: model.generate_audio,
        extra: {
          durationValues: model.supported_durations,
          supportedResolutions: model.supported_resolutions,
          supportedAspectRatios: model.supported_aspect_ratios,
          supportedSizes: model.supported_sizes,
          pricingSkus: model.pricing_skus,
          allowedPassthroughParameters: model.allowed_passthrough_parameters,
        },
      } satisfies Model]
    })
    }
    if (mediaType === 'image') return loadImages()
    if (mediaType === 'video') return loadVideos()
    const [images, videos] = await Promise.all([loadImages(), loadVideos()])
    return [...images, ...videos]
  }
}
