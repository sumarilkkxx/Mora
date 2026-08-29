/**
 * Atlas Cloud video provider.
 *
 * Official protocol (not OpenAI /videos compatible):
 * - POST /api/v1/model/generateVideo
 * - GET  /api/v1/model/prediction/{id}
 * - POST /api/v1/model/uploadMedia (multipart)
 *
 * Settings store a model family. The adapter resolves only the operation suffix from
 * the actual request inputs; it never changes the selected family/tier.
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import { BaseProvider, ProviderError } from './base'
import {
  ATLAS_VIDEO_FAMILIES,
  ATLAS_VIDEO_MODELS,
  atlasVideoModeForOptions,
  resolveAtlasVideoModelId,
  type AtlasVideoModelSpec,
} from '@/lib/atlas-video-models'
import {
  atlasCatalogFamilyId,
  atlasCatalogMode,
  getAtlasInputSchema,
  getAtlasVideoCatalog,
  routeAtlasCatalogModel,
} from '@/lib/atlas-video-catalog'
import { buildAtlasSchemaRequest } from '@/lib/atlas-video-request'
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

function modelSpec(modelId: string): AtlasVideoModelSpec | undefined {
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
    const requestedMode = atlasVideoModeForOptions(options)
    let routedModelId = resolveAtlasVideoModelId(options.modelId, requestedMode)
    if (!modelSpec(routedModelId)) {
      const catalog = await getAtlasVideoCatalog()
      routedModelId = routeAtlasCatalogModel(options.modelId, requestedMode, catalog) ?? ''
      if (!routedModelId) {
        throw new ProviderError(
          `Atlas Cloud 模型 ${options.modelId} 没有与当前任务 ${requestedMode} 匹配的处理节点`,
          'MODEL_MODE_MISMATCH',
          this.name,
        )
      }
    }
    const spec = modelSpec(routedModelId)
    console.info('[ATLAS_VIDEO_ROUTE]', {
      workflow: options.workflow ?? 'legacy-inference',
      configuredModel: options.modelId,
      routedModel: routedModelId,
    })

    if (!spec) {
      let body: Record<string, unknown>
      try {
        body = buildAtlasSchemaRequest(routedModelId, requestedMode, options, await getAtlasInputSchema(routedModelId))
      } catch (error) {
        throw new ProviderError(
          error instanceof Error ? error.message : `无法读取 ${routedModelId} 的 Atlas 输入 Schema`,
          'MODEL_SCHEMA_UNAVAILABLE',
          this.name,
        )
      }
      return this.submitAtlasRequest(routedModelId, body)
    }

    const isH3 = spec.requestProfile === 'h3'
    const requestedResolution = toResolution(options.width, options.height) ?? '720p'
    const rank = (candidate: string) => candidate.toLowerCase() === '2k' ? 1440 : Number.parseInt(candidate, 10) || 0
    const rankedResolutions = [...spec.resolutions].sort((a, b) => rank(a) - rank(b))
    const resolution = spec.resolutions.includes(requestedResolution)
      ? requestedResolution
      : rankedResolutions.find((value) => rank(value) >= rank(requestedResolution)) ?? rankedResolutions[rankedResolutions.length - 1]
    // Image-to-video is anchored to the source frame. Seedance 2.5 requires
    // `adaptive`, and using it for 2.0 also preserves the user's keyframe framing.
    const ratio = spec.mode === 'image-to-video' ? 'adaptive' : toRatio(options.width, options.height) ?? 'adaptive'
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
      model: routedModelId,
      prompt: options.prompt,
      duration,
      resolution,
      ratio,
      ...(!isH3 && options.audioEnabled != null ? { generate_audio: options.audioEnabled } : {}),
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
      if (options.lastFrameUrl) body[isH3 ? 'end_image' : 'last_image'] = options.lastFrameUrl
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
      if (isH3) {
        if (!uniqueImages.length && !uniqueVideos.length && !uniqueAudios.length) {
          throw new ProviderError(`${options.modelId} 的参考生视频任务至少需要一个参考素材`, 'MISSING_REFERENCE', this.name)
        }
        body.refers = [...uniqueImages, ...uniqueVideos, ...uniqueAudios].map((url) => ({ url }))
      } else {
        if (uniqueImages.length) body.reference_images = uniqueImages
        if (uniqueVideos.length) body.reference_videos = uniqueVideos
        if (uniqueAudios.length) body.reference_audios = uniqueAudios
      }
    }

    return this.submitAtlasRequest(routedModelId, body)
  }

  private async submitAtlasRequest(routedModelId: string, body: Record<string, unknown>): Promise<{ taskId: string; modelId: string }> {
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
    return { taskId, modelId: routedModelId }
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
    const catalog = await getAtlasVideoCatalog()
    const groups = new Map<string, typeof catalog>()
    const standalone = [] as typeof catalog
    for (const model of catalog) {
      const family = atlasCatalogFamilyId(model.id)
      if (!family) {
        standalone.push(model)
        continue
      }
      const group = groups.get(family) ?? []
      group.push(model)
      groups.set(family, group)
    }
    const models: Model[] = []
    for (const [family, entries] of groups) {
      if (entries.length < 2) {
        standalone.push(...entries)
        continue
      }
      const modes = [...new Set(entries.flatMap((entry) => {
        const mode = atlasCatalogMode(entry)
        return mode === 'reference-to-video' ? ['video-to-video' as const] : mode ? [mode] : []
      }))]
      const knownFamily = ATLAS_VIDEO_FAMILIES.find((candidate) => candidate.id === family)
      models.push({
        id: family,
        name: `${entries[0].name.replace(/\s+(?:Text|Image|Reference)[ -]to[ -]Video.*$/i, '')} · Auto`,
        description: `Atlas Cloud 自动路由 ${entries.map((entry) => atlasCatalogMode(entry)).filter(Boolean).join(' / ')}`,
        modes,
        mediaType: 'video',
        provider: this.name,
        supportsAudio: knownFamily ? true : entries.some((entry) => /audio|sound/i.test(entry.description ?? '')),
        extra: {
          automaticModeRouting: true,
          atlasEndpoints: entries.map((entry) => entry.id),
          supportedResolutions: knownFamily?.resolutions,
          supportedDurations: knownFamily?.durations,
          estimatedPricePerUnit: knownFamily?.pricePerSecond,
          priceUnit: knownFamily?.pricePerSecond != null ? "second" : undefined,
        },
      })
    }
    for (const entry of standalone) {
      const mode = atlasCatalogMode(entry)
      models.push({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        modes: mode === 'reference-to-video' ? ['video-to-video'] : mode ? [mode] : ['video-to-video'],
        mediaType: 'video',
        provider: this.name,
        supportsAudio: /audio|sound/i.test(entry.description ?? ''),
        extra: {
          atlasCategories: entry.categories,
          estimatedPricePerUnit: entry.pricePerUnit,
          priceUnit: entry.priceUnit,
          automaticModeRouting: false,
        },
      })
    }
    return models.sort((a, b) => a.name.localeCompare(b.name))
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
