/**
 * VolcEngine (Ark) provider implementation
 * Official API docs:
 * - Image (Seedream) sync: POST /api/v3/images/generations  https://www.volcengine.com/docs/82379/1541523
 * - Video (Seedance) async: POST /api/v3/contents/generations/tasks + GET /tasks/{id}  https://www.volcengine.com/docs/82379/1366799
 * Auth: Authorization: Bearer <ARK_API_KEY>
 * Note: the legacy visual.volcengineapi.com Visual service requires AK/SK signing and is deprecated; all calls now go through Ark.
 */

import { BaseProvider, ProviderError } from './base'
import type {
  ProviderConfig,
  ImageOptions,
  ImageResult,
  VideoOptions,
  VideoResult,
  TaskStatus,
  TaskStatusEnum,
  Model,
  MediaType,
} from './types'

// ==================== Ark API response types ====================

/** Image generation response (OpenAI-compatible: data[].url) */
interface ArkImageResponse {
  model?: string
  data?: Array<{ url?: string; b64_json?: string; size?: string }>
  images?: string[] // some API docs return an images array instead; handled for compatibility
  error?: { code?: string; message?: string }
}

/** Video task creation response */
interface ArkTaskCreateResponse {
  id: string
  error?: { code?: string; message?: string }
}

/** Video task query response */
interface ArkTaskQueryResponse {
  id: string
  model?: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  content?: { video_url?: string; last_frame_url?: string }
  error?: { code?: string; message?: string }
}

/** Ark content-role caps (Content Generation API schema; verified against a production integration) */
const ARK_MAX_REFERENCE_IMAGES = 9
const ARK_MAX_REFERENCE_VIDEOS = 3
const ARK_MAX_REFERENCE_AUDIOS = 3

/** Map width/height to an Ark video ratio */
function toRatio(width?: number, height?: number): string {
  const w = width ?? 0
  const h = height ?? 0
  if (w > h) return '16:9'
  if (h > w) return '9:16'
  if (w === h && w > 0) return '1:1'
  return 'adaptive'
}

/** Map width/height to an Ark image size; falls back to "2K" when outside Ark's pixel range (model picks aspect ratio from prompt) */
function toImageSize(width?: number, height?: number): string {
  const w = width ?? 0
  const h = height ?? 0
  const total = w * h
  // Ark total pixel range [2560x1440=3686400, 4096x4096=16777216]
  if (total >= 3686400 && total <= 16777216) return `${w}x${h}`
  return '2K'
}

export class VolcEngineProvider extends BaseProvider {
  readonly name = 'volcengine'
  readonly displayName = '火山引擎'

  constructor(config: ProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
    })
  }

  /** Ark authenticates with a Bearer API key */
  protected getAuthHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}` }
  }

  /**
   * Generate an image (Seedream — synchronous, no polling needed)
   */
  async generateImage(options: ImageOptions): Promise<ImageResult> {
    const body: Record<string, unknown> = {
      model: options.modelId,
      prompt: options.prompt,
      size: toImageSize(options.width, options.height),
      response_format: 'url',
      watermark: false,
      // image-to-image / edit: pass image (URL or base64)
      ...(options.referenceImageUrl && { image: options.referenceImageUrl }),
      ...options.extra,
    }

    const resp = await this.request<ArkImageResponse>('/images/generations', {
      method: 'POST',
      body,
    })

    if (resp.error) {
      throw new ProviderError(
        `火山方舟图像生成失败: ${resp.error.message ?? resp.error.code}`,
        resp.error.code ?? 'ARK_IMAGE_ERROR',
        this.name
      )
    }

    // Prefer data[].url; fall back to images[] string array for compatibility
    const urls = (resp.data?.map((d) => d.url).filter(Boolean) as string[]) ?? []
    if (urls.length === 0 && Array.isArray(resp.images)) {
      urls.push(...resp.images)
    }
    if (urls.length === 0) {
      throw new ProviderError('图像生成成功但未返回 URL', 'NO_RESULT', this.name)
    }

    return {
      taskId: 'sync',
      imageUrls: urls,
      modelId: options.modelId,
    }
  }

  /**
   * Build the content array per the Ark Content Generation API role protocol:
   * image_url entries carry role first_frame / last_frame / reference_image (≤9),
   * video_url entries role reference_video (≤3), audio_url entries role
   * reference_audio (≤3). Overflow is truncated client-side — the API hard-rejects it.
   */
  private buildVideoContent(options: VideoOptions): Array<Record<string, unknown>> {
    let text = options.prompt
    if (options.audioEnabled && options.voiceover) {
      text = `${options.prompt}。旁白：「${options.voiceover}」`
    }
    const content: Array<Record<string, unknown>> = [{ type: 'text', text }]
    if (options.firstFrameUrl) {
      content.push({ type: 'image_url', image_url: { url: options.firstFrameUrl }, role: 'first_frame' })
    }
    if (options.lastFrameUrl) {
      content.push({ type: 'image_url', image_url: { url: options.lastFrameUrl }, role: 'last_frame' })
    }
    for (const url of (options.referenceImageUrls ?? []).slice(0, ARK_MAX_REFERENCE_IMAGES)) {
      content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
    }
    for (const url of (options.referenceVideoUrls ?? []).slice(0, ARK_MAX_REFERENCE_VIDEOS)) {
      content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' })
    }
    for (const url of (options.referenceAudioUrls ?? []).slice(0, ARK_MAX_REFERENCE_AUDIOS)) {
      content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })
    }
    return content
  }

  /**
   * Phase 1 of the two-phase contract (paid-task safety): submit and return the task ID
   * immediately so the caller can persist it BEFORE polling — a lost poll then recovers
   * the paid task instead of double-billing a resubmit.
   */
  async submitVideoTask(options: VideoOptions): Promise<{ taskId: string; modelId: string }> {
    const body: Record<string, unknown> = {
      model: options.modelId,
      content: this.buildVideoContent(options),
      ratio: toRatio(options.width, options.height),
      ...(options.duration != null && { duration: options.duration }),
      generate_audio: options.audioEnabled ?? false,
      watermark: false,
      // always ask for the clip's real final frame — it feeds tail-frame chaining and
      // sequential continuation past the single-call duration cap
      return_last_frame: true,
      ...(options.seed != null && { seed: options.seed }),
      ...options.extra,
    }

    const created = await this.request<ArkTaskCreateResponse>(
      '/contents/generations/tasks',
      { method: 'POST', body }
    )
    if (created.error || !created.id) {
      throw new ProviderError(
        `火山方舟视频任务创建失败: ${created.error?.message ?? '未返回任务 ID'}`,
        created.error?.code ?? 'ARK_TASK_ERROR',
        this.name
      )
    }
    return { taskId: created.id, modelId: options.modelId }
  }

  /**
   * Generate a video (Seedance — async task + polling). Prefer submitVideoTask +
   * waitForTask when the task ID must be persisted before polling.
   */
  async generateVideo(options: VideoOptions): Promise<VideoResult> {
    const { taskId } = await this.submitVideoTask(options)
    const finalStatus = await this.pollTaskStatus(taskId, { interval: 5000 })
    const result = this.requireResult(finalStatus.result) as VideoResult
    result.modelId = options.modelId
    return result
  }

  /**
   * Query task status (video async tasks only)
   */
  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const data = await this.request<ArkTaskQueryResponse>(
      `/contents/generations/tasks/${taskId}`
    )
    const status = this.mapStatus(data.status)

    const taskStatus: TaskStatus = { taskId: data.id, status }

    if (status === 'completed' && data.content?.video_url) {
      taskStatus.result = {
        taskId: data.id,
        videoUrls: [data.content.video_url],
        modelId: data.model ?? '',
        hasAudio: undefined,
        // real final frame (return_last_frame:true) — the seam primitive for chaining
        ...(data.content.last_frame_url && { lastFrameUrl: data.content.last_frame_url }),
      }
    }
    if (status === 'failed') {
      taskStatus.error = data.error?.message
      taskStatus.errorCode = data.error?.code
    }
    return taskStatus
  }

  /** Map Ark task status to unified status */
  private mapStatus(s: ArkTaskQueryResponse['status']): TaskStatusEnum {
    switch (s) {
      case 'queued':
        return 'pending'
      case 'running':
        return 'processing'
      case 'succeeded':
        return 'completed'
      case 'failed':
        return 'failed'
      case 'cancelled':
        return 'cancelled'
      default:
        return 'processing'
    }
  }

  /**
   * Fetch available model list.
   * VolcEngine Ark models use the doubao- prefix; you can also create inference endpoints in the console and call them by endpoint ID.
   * Source: https://www.volcengine.com/docs/82379
   */
  async listModels(mediaType?: MediaType): Promise<Model[]> {
    const models: Model[] = [
      // ==================== Video generation (Seedance) ====================
      {
        // Announced 2026-07-31; Ark API access is rolling out gradually — accounts
        // without access yet should stay on 2.0 (id verified against Ark pricing mirrors)
        id: 'doubao-seedance-2-5-260628',
        name: 'Seedance 2.5',
        description: '字节豆包视频生成 2.5，4-30 秒原生音频/人声（方舟陆续开放中，未开通可先用 2.0）',
        modes: ['text-to-video', 'image-to-video'],
        mediaType: 'video',
        provider: this.name,
        supportsAudio: true,
      },
      {
        id: 'doubao-seedance-2-0-260128',
        name: 'Seedance 2.0',
        description: '字节豆包视频生成 2.0，电影级画质，支持原生音频',
        modes: ['text-to-video', 'image-to-video'],
        mediaType: 'video',
        provider: this.name,
        supportsAudio: true,
      },
      {
        id: 'doubao-seedance-1-0-pro-250528',
        name: 'Seedance 1.0 Pro',
        description: '豆包视频 1.0 Pro，文/图生视频',
        modes: ['text-to-video', 'image-to-video'],
        mediaType: 'video',
        provider: this.name,
      },
      // ==================== Image generation (Seedream) ====================
      {
        id: 'doubao-seedream-5-0-260128',
        name: 'Seedream 5.0',
        description: '豆包图像 5.0，强中文理解、排版与质感（带货商品图佳）',
        modes: ['text-to-image', 'image-to-image'],
        mediaType: 'image',
        provider: this.name,
      },
      {
        id: 'doubao-seedream-4-0-250828',
        name: 'Seedream 4.0',
        description: '豆包图像 4.0，多图参考输入，商品保真编辑',
        modes: ['text-to-image', 'image-to-image'],
        mediaType: 'image',
        provider: this.name,
      },
    ]

    if (mediaType) return models.filter((m) => m.mediaType === mediaType)
    return models
  }
}
