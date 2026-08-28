/**
 * Atlas Cloud video provider.
 *
 * Official protocol (not OpenAI /videos compatible):
 * - POST /api/v1/model/generateVideo
 * - GET  /api/v1/model/prediction/{id}
 * - POST /api/v1/model/uploadMedia (multipart)
 *
 * Model IDs include the operation suffix. We preserve the selected ID exactly and
 * validate its schema before the billable POST instead of silently changing tier,
 * resolution, duration, or generation mode.
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
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

const DEFAULT_BASE_URL = 'https://api.atlascloud.ai/api/v1'
const DURATIONS_2_0 = Array.from({ length: 12 }, (_, index) => index + 4)
const DURATIONS_2_5 = Array.from({ length: 27 }, (_, index) => index + 4)
const RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']

type AtlasMode = 'text-to-video' | 'image-to-video' | 'reference-to-video'

interface AtlasModelSpec {
  id: string
  name: string
  mode: AtlasMode
  durations: number[]
  resolutions: string[]
  ratios: string[]
  maxReferenceImages?: number
  maxReferenceVideos?: number
  maxReferenceAudios?: number
  supportsLastFrame: boolean
  pricePerSecond?: number
}

function seedanceFamily(
  family: string,
  label: string,
  durations: number[],
  resolutions: string[],
  pricePerSecond?: number,
): AtlasModelSpec[] {
  return (['reference-to-video', 'image-to-video', 'text-to-video'] as const).map((mode) => ({
    id: `bytedance/${family}/${mode}`,
    name: `${label} · ${mode === 'reference-to-video' ? '参考生视频' : mode === 'image-to-video' ? '图生视频' : '文生视频'}`,
    mode,
    durations,
    resolutions,
    ratios: RATIOS,
    maxReferenceImages: mode === 'reference-to-video' ? (family === 'seedance-2.5' ? 30 : 9) : undefined,
    maxReferenceVideos: mode === 'reference-to-video' ? (family === 'seedance-2.5' ? 10 : 3) : undefined,
    maxReferenceAudios: mode === 'reference-to-video' ? (family === 'seedance-2.5' ? 10 : 3) : undefined,
    supportsLastFrame: mode === 'image-to-video',
    pricePerSecond,
  }))
}

/**
 * Verified against Atlas Cloud model schemas. Prices are informational snapshots;
 * generation correctness never depends on them and the UI labels them as estimates.
 */
export const ATLAS_VIDEO_MODELS: readonly AtlasModelSpec[] = [
  ...seedanceFamily('seedance-2.0-mini', 'Seedance 2.0 Mini', DURATIONS_2_0, ['480p', '720p'], 0.039),
  ...seedanceFamily('seedance-2.0-fast', 'Seedance 2.0 Fast', DURATIONS_2_0, ['480p', '720p'], 0.09),
  ...seedanceFamily('seedance-2.0', 'Seedance 2.0', DURATIONS_2_0, ['480p', '720p', '1080p'], 0.112),
  ...seedanceFamily('seedance-2.5', 'Seedance 2.5', DURATIONS_2_5, ['480p', '720p'], 0.134),
]

interface AtlasEnvelope<T> {
  code?: number
  message?: string
  data?: T
}

interface AtlasPrediction {
  id?: string
  status?: string
  model?: string
  outputs?: Array<string | { url?: string; download_url?: string }>
  urls?: Record<string, string> | string[]
  error?: string | { message?: string; code?: string }
  created_at?: string
  updated_at?: string
  completion_tokens?: number
  total_tokens?: number
}

interface AtlasUploadResponse {
  url?: string
  download_url?: string
  data?: { url?: string; download_url?: string }
}

function modelSpec(modelId: string): AtlasModelSpec | undefined {
  return ATLAS_VIDEO_MODELS.find((model) => model.id === modelId)
}

function toRatio(width?: number, height?: number): string | undefined {
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

function mimeFromPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.mov': return 'video/quicktime'
    case '.mp3': return 'audio/mpeg'
    case '.wav': return 'audio/wav'
    default: return 'video/mp4'
  }
}

function outputUrls(prediction: AtlasPrediction): string[] {
  const outputs = (prediction.outputs ?? []).flatMap((output) => {
    if (typeof output === 'string') return output ? [output] : []
    return output.url ? [output.url] : output.download_url ? [output.download_url] : []
  })
  if (outputs.length) return outputs
  if (Array.isArray(prediction.urls)) return prediction.urls.filter(Boolean)
  if (prediction.urls && typeof prediction.urls === 'object') return Object.values(prediction.urls).filter(Boolean)
  return []
}

export class AtlasCloudProvider extends BaseProvider {
  readonly name = 'atlas-cloud'
  readonly displayName = 'Atlas Cloud'

  constructor(config: ProviderConfig) {
    super({ ...config, baseUrl: (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '') })
  }

  async generateImage(_options: ImageOptions): Promise<ImageResult> {
    throw new ProviderError('Atlas Cloud 当前在 Mora 中仅启用已校验的视频模型', 'UNSUPPORTED_MEDIA_TYPE', this.name)
  }

  async submitVideoTask(options: VideoOptions): Promise<{ taskId: string; modelId: string }> {
    const spec = modelSpec(options.modelId)
    if (!spec) {
      throw new ProviderError(
        `Atlas Cloud 模型 ${options.modelId} 尚未在 Mora 中完成参数校验，已阻止付费提交`,
        'UNVERIFIED_MODEL',
        this.name,
      )
    }

    const resolution = toResolution(options.width, options.height) ?? '720p'
    const ratio = toRatio(options.width, options.height) ?? 'adaptive'
    const duration = options.duration ?? 5
    if (!Number.isInteger(duration) || !spec.durations.includes(duration)) {
      throw new ProviderError(
        `${options.modelId} 不支持 ${duration}s；支持时长：${spec.durations.join(', ')}s`,
        'UNSUPPORTED_DURATION',
        this.name,
      )
    }
    if (!spec.resolutions.includes(resolution)) {
      throw new ProviderError(
        `${options.modelId} 不支持 ${resolution}；支持分辨率：${spec.resolutions.join(', ')}`,
        'UNSUPPORTED_RESOLUTION',
        this.name,
      )
    }
    if (!spec.ratios.includes(ratio)) {
      throw new ProviderError(`${options.modelId} 不支持画面比例 ${ratio}`, 'UNSUPPORTED_ASPECT_RATIO', this.name)
    }

    const referenceImages = [...(options.referenceImageUrls ?? [])]
    const referenceVideos = [
      ...(options.referenceVideoUrls ?? []),
      ...(options.referenceVideoUrl ? [options.referenceVideoUrl] : []),
    ]
    const referenceAudios = options.referenceAudioUrls ?? []
    const body: Record<string, unknown> = {
      model: options.modelId,
      prompt: options.prompt,
      duration,
      resolution,
      ratio,
      ...(options.audioEnabled != null ? { generate_audio: options.audioEnabled } : {}),
      ...(options.seed != null ? { seed: options.seed } : {}),
    }

    const extra = options.extra ?? {}
    if (extra.bitrate_mode === 'standard' || extra.bitrate_mode === 'high') body.bitrate_mode = extra.bitrate_mode
    if (typeof extra.watermark === 'boolean') body.watermark = extra.watermark
    if (typeof extra.return_last_frame === 'boolean') body.return_last_frame = extra.return_last_frame

    if (spec.mode === 'text-to-video') {
      if (options.firstFrameUrl || options.lastFrameUrl || referenceImages.length || referenceVideos.length || referenceAudios.length) {
        throw new ProviderError(
          `${options.modelId} 是文生视频端点，不能接收图片/视频/音频参考；请选择 image-to-video 或 reference-to-video 端点`,
          'MODEL_MODE_MISMATCH',
          this.name,
        )
      }
    } else if (spec.mode === 'image-to-video') {
      if (!options.firstFrameUrl) {
        throw new ProviderError(`${options.modelId} 必须提供首帧图片`, 'MISSING_FIRST_FRAME', this.name)
      }
      if (referenceImages.length || referenceVideos.length || referenceAudios.length) {
        throw new ProviderError(
          `${options.modelId} 只接受首尾帧；多参考素材请选择 reference-to-video 端点`,
          'MODEL_MODE_MISMATCH',
          this.name,
        )
      }
      body.image = options.firstFrameUrl
      if (options.lastFrameUrl) body.last_image = options.lastFrameUrl
    } else {
      if (options.lastFrameUrl) {
        throw new ProviderError(
          `${options.modelId} 不支持把 lastImage 作为尾帧约束；请选择 image-to-video 端点`,
          'UNSUPPORTED_LAST_FRAME',
          this.name,
        )
      }
      if (options.firstFrameUrl) referenceImages.unshift(options.firstFrameUrl)
      const uniqueImages = [...new Set(referenceImages)]
      const uniqueVideos = [...new Set(referenceVideos)]
      const uniqueAudios = [...new Set(referenceAudios)]
      if (uniqueImages.length > (spec.maxReferenceImages ?? 0)) {
        throw new ProviderError(`参考图 ${uniqueImages.length} 张超过模型上限 ${spec.maxReferenceImages}`, 'TOO_MANY_REFERENCES', this.name)
      }
      if (uniqueVideos.length > (spec.maxReferenceVideos ?? 0)) {
        throw new ProviderError(`参考视频 ${uniqueVideos.length} 个超过模型上限 ${spec.maxReferenceVideos}`, 'TOO_MANY_REFERENCES', this.name)
      }
      if (uniqueAudios.length > (spec.maxReferenceAudios ?? 0)) {
        throw new ProviderError(`参考音频 ${uniqueAudios.length} 个超过模型上限 ${spec.maxReferenceAudios}`, 'TOO_MANY_REFERENCES', this.name)
      }
      if (uniqueImages.length) body.reference_images = uniqueImages
      if (uniqueVideos.length) body.reference_videos = uniqueVideos
      if (uniqueAudios.length) body.reference_audios = uniqueAudios
    }

    const response = await this.request<AtlasEnvelope<AtlasPrediction>>('/model/generateVideo', {
      method: 'POST',
      timeout: 60000,
      body,
    })
    const taskId = response.data?.id
    if (!taskId) {
      throw new ProviderError(
        `Atlas Cloud 未返回 prediction ID${response.message ? `：${response.message}` : ''}`,
        'NO_TASK_ID',
        this.name,
      )
    }
    return { taskId, modelId: options.modelId }
  }

  async generateVideo(options: VideoOptions): Promise<VideoResult> {
    const { taskId, modelId } = await this.submitVideoTask(options)
    const finalStatus = await this.pollTaskStatus(taskId, { interval: 5000 })
    const result = this.requireResult(finalStatus.result) as VideoResult
    result.modelId = modelId
    return result
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const response = await this.request<AtlasEnvelope<AtlasPrediction>>(`/model/prediction/${encodeURIComponent(taskId)}`)
    const prediction = response.data
    if (!prediction) throw new ProviderError('Atlas Cloud 状态响应缺少 data', 'MALFORMED_RESPONSE', this.name)
    const status = this.mapStatus(prediction.status)
    const error = typeof prediction.error === 'string' ? prediction.error : prediction.error?.message
    const urls = outputUrls(prediction)
    const result: TaskStatus = {
      taskId: prediction.id || taskId,
      status,
      error,
      errorCode: typeof prediction.error === 'object' ? prediction.error.code : undefined,
      createdAt: prediction.created_at,
      updatedAt: prediction.updated_at,
      extra: {
        completionTokens: prediction.completion_tokens,
        totalTokens: prediction.total_tokens,
      },
    }
    if (status === 'completed' && urls.length) {
      result.result = {
        taskId: prediction.id || taskId,
        videoUrls: urls,
        modelId: prediction.model || '',
        extra: {
          completionTokens: prediction.completion_tokens,
          totalTokens: prediction.total_tokens,
        },
      }
    }
    return result
  }

  async uploadLocalMedia(filePath: string): Promise<string> {
    const data = await readFile(filePath)
    const form = new FormData()
    form.append('file', new Blob([data], { type: mimeFromPath(filePath) }), filePath.split(/[\\/]/).pop() || 'upload.bin')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000)
    try {
      const response = await fetch(`${this.config.baseUrl}/model/uploadMedia`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: form,
        signal: controller.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new ProviderError(`Atlas Cloud 上传失败: ${response.status} ${response.statusText} - ${text}`, 'UPLOAD_FAILED', this.name, response.status)
      }
      let parsed: AtlasUploadResponse
      try {
        parsed = JSON.parse(text) as AtlasUploadResponse
      } catch {
        throw new ProviderError('Atlas Cloud 上传响应不是有效 JSON', 'MALFORMED_RESPONSE', this.name)
      }
      const url = parsed.url || parsed.download_url || parsed.data?.url || parsed.data?.download_url
      if (!url) throw new ProviderError('Atlas Cloud 上传成功但未返回媒体 URL', 'NO_UPLOAD_URL', this.name)
      return url
    } catch (error) {
      if (error instanceof ProviderError) throw error
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      throw new ProviderError(aborted ? 'Atlas Cloud 媒体上传超时' : `Atlas Cloud 媒体上传失败: ${error instanceof Error ? error.message : String(error)}`, aborted ? 'TIMEOUT' : 'NETWORK_ERROR', this.name)
    } finally {
      clearTimeout(timeout)
    }
  }

  async listModels(mediaType?: MediaType): Promise<Model[]> {
    if (mediaType === 'image') return []
    return ATLAS_VIDEO_MODELS.map((model) => ({
      id: model.id,
      name: model.name,
      description: 'Atlas Cloud 已校验视频端点',
      modes: model.mode === 'text-to-video'
        ? ['text-to-video']
        : model.mode === 'image-to-video'
          ? ['image-to-video']
          : ['video-to-video', 'image-to-video'],
      mediaType: 'video',
      provider: this.name,
      supportsAudio: true,
      extra: {
        durationValues: model.durations,
        supportedResolutions: model.resolutions,
        supportedAspectRatios: model.ratios,
        maxReferenceImages: model.maxReferenceImages,
        maxReferenceVideos: model.maxReferenceVideos,
        maxReferenceAudios: model.maxReferenceAudios,
        supportsLastFrame: model.supportsLastFrame,
        estimatedPricePerSecond: model.pricePerSecond,
        priceIsEstimate: true,
      },
    }))
  }

  private mapStatus(status?: string): TaskStatusEnum {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'succeeded': return 'completed'
      case 'failed':
      case 'timeout': return 'failed'
      case 'cancelled':
      case 'canceled': return 'cancelled'
      case 'pending':
      case 'queued': return 'pending'
      case 'processing':
      case 'running':
      default: return 'processing'
    }
  }
}
