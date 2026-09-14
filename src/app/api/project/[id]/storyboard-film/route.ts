import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getDataDir } from "@/lib/paths";
import { getDb } from "@/lib/db";
import { scripts, assets, compositions, projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { createProvider } from "@/lib/providers";
import { GRID_MAX_SHOTS } from "@/lib/storyboard-grid";
import {
  buildStoryboardFilmPrompt,
  dialogueDensityWarnings,
  filmTotalSeconds,
  filmRequestSeconds,
  referenceQuotaCheck,
  resolveStoryboardFilmModel,
  closestSupportedFilmDuration,
  fallbackFilmDurations,
  fitFilmShotsToDuration,
  supportedVideoSetting,
  videoRequestAspectRatio,
  videoRequestDimensions,
  videoRequestResolution,
  FILM_MAX_SECONDS,
} from "@/lib/storyboard-film";
import { toRemoteUsableImage } from "@/lib/remote-image";
import { probeMedia } from "@/lib/media-probe";
import { recordAiTask } from "@/lib/ai-tasks";
import { insufficientBalanceDetails } from "@/lib/provider-billing-error";
import { estimateVideoSpend, resolveVideoSpendCap } from "@/lib/video-spend";
import { apiError, errText } from "@/lib/api-error";
import { contentPolicyError, isContentPolicyRejection } from "@/lib/content-policy-error";
import type { GenAspectRatio, GenResolution } from "@/lib/gen-params";
import { resolveAtlasVideoModelId } from "@/lib/atlas-video-models";
import { validateOrDelete } from "@/lib/media-validate";
import { readResponseBuffer, safeFetch } from "@/lib/ssrf-guard";

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|bmp|gif)$/i;
const MAX_FILM_BYTES = 200 * 1024 * 1024;

/** A shot's usable keyframe IMAGE: an image asset's filePath, or a video asset's preserved keyframe */
function shotKeyframe(asset: { filePath?: string | null; thumbnailPath?: string | null } | undefined): string | undefined {
  if (!asset) return undefined;
  if (asset.filePath && IMAGE_EXT_RE.test(asset.filePath)) return asset.filePath;
  if (asset.thumbnailPath && IMAGE_EXT_RE.test(asset.thumbnailPath)) return asset.thumbnailPath;
  return undefined;
}

/**
 * POST /api/project/[id]/storyboard-film — grid to full film (九宫格→一键整片).
 *
 * Feeds every shot's keyframe (typically the storyboard grid's cropped cells) as
 * reference images into a single reference-to-video generation with a timecoded
 * multi-shot prompt: native cuts between shots, person/product locked across
 * cuts, dialogue spoken verbatim with continuous audio. The result lands in the
 * compositions table, so the export page picks it up like any composed video.
 *
 * body: { scriptId, provider, apiKey, model?, baseUrl?, options? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let billingProviderName = "";
  let billingModel = "";
  try {
    const { id } = await params;
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return apiError(req, "无效的项目ID", "Invalid project id", 400);
    }
    const body = await req.json();
    const { scriptId, provider: providerName, model, apiKey, baseUrl, options, characterSheetUrl, dryRun, spendCapUsd, acknowledgeOverCap } = body as {
      scriptId?: string;
      provider?: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
      options?: Record<string, unknown>;
      /** Presenter's multi-view sheet — leads reference_images as the identity anchor (@Image1) */
      characterSheetUrl?: string;
      /** Preview only: return the full film prompt + counts + warnings, submit nothing, spend nothing */
      dryRun?: boolean;
      /** Refuse a priced paid submission above this USD ceiling unless explicitly acknowledged. */
      spendCapUsd?: number;
      acknowledgeOverCap?: boolean;
    };
    billingProviderName = providerName ?? "";
    billingModel = model ?? "";
    if (!scriptId) {
      return apiError(req, "缺少 scriptId", "Missing scriptId", 400);
    }

    const db = getDb();
    const [script] = await db
      .select()
      .from(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.projectId, id)));
    if (!script) return apiError(req, "脚本不存在", "Script not found", 404);
    const shots = Array.isArray(script.shots) ? script.shots : [];
    if (shots.length < 2) {
      return apiError(req, "分镜太少，一键整片至少需要 2 个分镜", "Too few shots — the film pass needs at least 2", 400);
    }
    if (shots.length > GRID_MAX_SHOTS) {
      return apiError(
        req,
        `一键整片最多 ${GRID_MAX_SHOTS} 个分镜（当前 ${shots.length} 个）——长脚本请用逐镜生成+成片合成`,
        `The film pass holds at most ${GRID_MAX_SHOTS} shots (this script has ${shots.length}) — use per-shot generation + compose for longer scripts`,
        400
      );
    }
    const totalSec = filmTotalSeconds(shots);
    if (totalSec > FILM_MAX_SECONDS) {
      return apiError(
        req,
        `脚本总时长 ${Math.round(totalSec)} 秒超过单次生成上限 ${FILM_MAX_SECONDS} 秒——请缩短脚本，或用逐镜生成+成片合成`,
        `Total script duration ${Math.round(totalSec)}s exceeds the ${FILM_MAX_SECONDS}s single-generation cap — shorten the script or use per-shot generation + compose`,
        400
      );
    }

    const resolvedModel = resolveStoryboardFilmModel(providerName, model);
    if (!resolvedModel) {
      return apiError(req, "缺少视频模型 ID，请在设置中选择视频模型", "Missing video model id — select a video model in Settings", 400);
    }
    const submittedModel = providerName?.toLowerCase() === "atlas-cloud"
      ? resolveAtlasVideoModelId(resolvedModel, "reference-to-video")
      : resolvedModel;
    const requestedDuration = filmRequestSeconds(shots);
    const opts = (options ?? {}) as {
      width?: number;
      height?: number;
      fps?: number;
      motionStrength?: number;
      negativePrompt?: string;
      seed?: number;
    };
    const requestedResolution = videoRequestResolution(opts.width, opts.height);
    const requestedAspectRatio = videoRequestAspectRatio(opts.width, opts.height);
    let supportedDurations = fallbackFilmDurations(providerName, submittedModel);
    let supportedResolutions: string[] | undefined;
    let supportedAspectRatios: string[] | undefined;
    let pricePerSecond: number | undefined;
    let provider = providerName && (dryRun || apiKey)
      ? createProvider({ name: providerName, apiKey: apiKey ?? "", baseUrl: baseUrl ?? "" })
      : undefined;
    if (provider) {
      try {
        const availableModels = await provider.listModels("video");
        const liveModel = availableModels.find((entry) => entry.id === resolvedModel);
        if (["openrouter", "atlas-cloud"].includes(providerName?.toLowerCase() ?? "") && !liveModel) {
          return apiError(
            req,
            `${providerName} 当前已校验的视频模型目录中不存在 ${resolvedModel}，请回到设置重新选择模型`,
            `${resolvedModel} is not present in ${providerName}'s verified video model directory — select the model again in Settings`,
            400
          );
        }
        const liveValues = liveModel?.extra?.durationValues;
        const liveResolutions = liveModel?.extra?.supportedResolutions;
        const liveAspectRatios = liveModel?.extra?.supportedAspectRatios;
        const livePrice = Number(liveModel?.extra?.estimatedPricePerUnit);
        if (Number.isFinite(livePrice) && livePrice >= 0) pricePerSecond = livePrice;
        if (Array.isArray(liveValues)) {
          const normalized = liveValues.filter(
            (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0
          );
          if (normalized.length > 0) supportedDurations = normalized;
        }
        if (Array.isArray(liveResolutions)) {
          supportedResolutions = liveResolutions.filter((value): value is string => typeof value === "string");
        }
        if (Array.isArray(liveAspectRatios)) {
          supportedAspectRatios = liveAspectRatios.filter((value): value is string => typeof value === "string");
        }
      } catch (error) {
        console.warn(`读取 ${providerName} 模型时长能力失败，使用安全兜底:`, error);
      }
    }
    const duration = closestSupportedFilmDuration(requestedDuration, supportedDurations);
    const supportsRequestedDuration = !supportedDurations?.length
      || supportedDurations.some((value) => Math.abs(value - requestedDuration) < 0.01);
    if (!supportsRequestedDuration) {
      const supportedLabel = (supportedDurations ?? []).join(" / ");
      return NextResponse.json({
        error: errText(
          req,
          `当前模型不支持 ${requestedDuration} 秒整片（支持：${supportedLabel} 秒）。为避免静默缩短和破坏分镜节奏，本次未提交付费任务；请选择支持该时长的模型，或改用逐镜生成并通过关键帧/尾帧接续后合成。`,
          `This model cannot generate a ${requestedDuration}s film (supported: ${supportedLabel}s). No paid task was submitted because silently shortening would break storyboard timing. Choose a model that supports the target or use chained per-shot generation and compose.`,
        ),
        code: "TARGET_DURATION_UNSUPPORTED",
        requestedDuration,
        supportedDurations,
        taskSubmitted: false,
      }, { status: 409 });
    }
    const resolution = supportedVideoSetting(requestedResolution, supportedResolutions, "720p");
    const aspectRatio = supportedVideoSetting(requestedAspectRatio, supportedAspectRatios, "9:16");
    if (!(resolution === "720p" || resolution === "1080p")) {
      return apiError(req, `该模型只支持当前界面尚未提供的分辨率 ${resolution}`, `This model only supports ${resolution}, which is not available in the current settings UI`, 400);
    }
    if (!(aspectRatio === "9:16" || aspectRatio === "16:9" || aspectRatio === "1:1")) {
      return apiError(req, `该模型只支持当前界面尚未提供的画面比例 ${aspectRatio}`, `This model only supports ${aspectRatio}, which is not available in the current settings UI`, 400);
    }
    const dimensions = videoRequestDimensions(resolution, aspectRatio);
    const estimate = estimateVideoSpend(pricePerSecond, duration, resolution);
    const ignoredSettings = ["openrouter", "atlas-cloud"].includes(providerName?.toLowerCase() ?? "")
      ? [opts.fps != null ? "fps" : "", opts.motionStrength != null ? "motionStrength" : "", opts.negativePrompt ? "negativePrompt" : ""].filter(Boolean)
      : [];
    const effectiveShots = fitFilmShotsToDuration(shots, duration);
    const prompt = buildStoryboardFilmPrompt(effectiveShots, script.characters, { characterSheet: !!characterSheetUrl });
    const dialogueWarnings = dialogueDensityWarnings(effectiveShots);

    if (dryRun) {
      // planned reference count: one keyframe per shot (+ the identity sheet when present) —
      // computable before the grid pass has actually rendered the keyframes
      const plannedRefs = shots.length + (characterSheetUrl ? 1 : 0);
      return NextResponse.json({
        dryRun: true,
        modelId: submittedModel,
        prompt,
        shotCount: shots.length,
        seconds: duration,
        requestedSeconds: requestedDuration,
        durationAdjusted: duration !== requestedDuration,
        supportedDurations,
        requestSettings: {
          modelId: submittedModel,
          resolution,
          requestedResolution,
          aspectRatio,
          requestedAspectRatio,
          duration,
          requestedDuration,
          generateAudio: true,
          ...(opts.seed != null ? { seed: opts.seed } : {}),
        },
        ...(estimate && { estimate }),
        ignoredSettings,
        referenceImages: plannedRefs,
        referenceQuota: referenceQuotaCheck(plannedRefs, submittedModel, providerName),
        dialogueWarnings,
      });
    }

    // This is the last server-side gate before media preparation and the paid provider POST.
    // Compare against the conservative tier-adjusted total; a base catalog price alone is not
    // representative of what Atlas bills at 720p/1080p.
    const cap = resolveVideoSpendCap(spendCapUsd);
    if (estimate && cap > 0 && estimate.maxUsd > cap && !acknowledgeOverCap) {
      return apiError(
        req,
        `预估花费最高 $${estimate.maxUsd.toFixed(2)}（$${estimate.unitUsd}/秒 × ${estimate.seconds} 秒 × ${estimate.tierMultiplier} 分辨率倍率），超过单次上限 $${cap.toFixed(2)}。请降低分辨率、缩短时长或明确确认继续。`,
        `Estimated spend is up to $${estimate.maxUsd.toFixed(2)} ($${estimate.unitUsd}/s × ${estimate.seconds}s × ${estimate.tierMultiplier} resolution multiplier), above the $${cap.toFixed(2)} per-run cap. Lower resolution or duration, or explicitly confirm to continue.`,
        409,
      );
    }

    // past the dryRun branch money moves — provider and key become mandatory
    // (dryRun spends nothing, so it needs neither)
    if (!providerName) {
      return apiError(req, "缺少 provider", "Missing provider", 400);
    }
    if (!apiKey) {
      return apiError(req, "缺少 API Key，请先在设置中配置视频平台", "Missing API key — configure a video provider in settings first", 400);
    }
    // every shot needs a keyframe IMAGE (grid cells or per-shot stills) to cite as @ImageN
    const assetRows = await db.select().from(assets).where(eq(assets.projectId, id));
    const byShot = new Map(assetRows.map((a) => [a.shotId, a]));
    const keyframes: string[] = [];
    const missing: number[] = [];
    for (const shot of shots) {
      const kf = shotKeyframe(byShot.get(shot.shotId));
      if (kf) keyframes.push(kf);
      else missing.push(shot.shotId);
    }
    if (missing.length > 0) {
      return apiError(
        req,
        `分镜 ${missing.join("、")} 还没有关键帧图——先跑「九宫格分镜」或逐镜生图`,
        `Shots ${missing.join(", ")} have no keyframe image yet — run the storyboard grid or per-shot generation first`,
        400
      );
    }
    // remote providers can't reach localhost: local /api/files keyframes travel as Base64.
    // With a character sheet it leads the array (@Image1 = identity anchor, shots shift to @Image2..)
    const refInputs = [...(characterSheetUrl ? [characterSheetUrl] : []), ...keyframes];
    // pre-spend quota gate: a reference count over the model's schema limit is a guaranteed
    // upstream rejection — block BEFORE the paid submit instead of paying to find out
    const quota = referenceQuotaCheck(refInputs.length, submittedModel, providerName);
    if (!quota.ok) {
      return apiError(
        req,
        `参考图 ${quota.count} 张超过该模型上限 ${quota.limit} 张——减少分镜数${characterSheetUrl ? "，或去掉定妆照（少一张参考位）" : ""}后再试`,
        `${quota.count} reference images exceed this model's limit of ${quota.limit} — reduce the shot count${characterSheetUrl ? " or drop the presenter sheet (frees one slot)" : ""} and retry`,
        400
      );
    }
    const referenceImageUrls = (await Promise.all(refInputs.map(toRemoteUsableImage))).filter(
      (u): u is string => !!u
    );

    // lip-sync guardrail (advisory, never blocks): overstuffed lines drift out of sync near the
    // end of a segment — surfaced so the UI/CLI can suggest trimming before the paid generation
    provider ??= createProvider({ name: providerName, apiKey, baseUrl: baseUrl ?? "" });

    const videoOptions = {
      ...(options ?? {}),
      modelId: submittedModel,
      mode: "video-to-video" as const,
      workflow: "storyboard-film" as const,
      prompt,
      referenceImageUrls,
      duration,
      // portrait 720p unless the caller asked otherwise — maps to resolution+ratio provider-side
      width: dimensions.width,
      height: dimensions.height,
      // native speech IS the feature: dialogue lives in the prompt, audio must be on
      audioEnabled: true,
    };

    // legacy single-phase path for providers without two-phase task support
    if (!provider.submitVideoTask || !provider.waitForTask) {
      const result = await provider.generateVideo(videoOptions);
      const saved = await persistFilm(id, result.videoUrls?.[0], result.modelId || submittedModel, resolution, aspectRatio);
      return NextResponse.json({
        ...saved,
        taskId: result.taskId,
        modelId: result.modelId,
        seconds: duration,
        requestedSeconds: requestedDuration,
        durationAdjusted: duration !== requestedDuration,
        supportedDurations,
        dialogueWarnings,
      });
    }

    // Phase 1: submit, then persist the paid task ID before polling (issue #16)
    const { taskId, modelId } = await provider.submitVideoTask(videoOptions);
    await recordAiTask({
      projectId: id,
      provider: providerName,
      model: modelId,
      mediaType: "video",
      mode: "storyboard-film",
      prompt,
      taskId,
    });

    // A one-call film can take minutes. Submission is the only foreground step;
    // the app-wide task center polls and persists the completed composition.
    return NextResponse.json({
      queued: true,
      status: "submitted",
      recoverable: true,
      taskId,
      modelId,
      seconds: duration,
      requestedSeconds: requestedDuration,
      durationAdjusted: duration !== requestedDuration,
      supportedDurations,
      dialogueWarnings,
    }, { status: 202 });

  } catch (error) {
    console.error("一键整片生成失败:", error);
    const billing = insufficientBalanceDetails(error, billingProviderName);
    if (billing) {
      console.warn("[STORYBOARD_FILM_INSUFFICIENT_BALANCE]", {
        provider: billing.provider,
        model: billingModel,
        statusCode: billing.statusCode ?? 402,
        taskSubmitted: billing.taskSubmitted,
      });
      const locale = req.headers.get("accept-language")?.toLowerCase().startsWith("en") ? "en" : "zh";
      const taskStateZh = billing.taskSubmitted
        ? "云端可能已经受理该任务，请先查询已有任务，不要重复提交。"
        : "本次任务未提交到云端，充值后可重新生成。";
      const taskStateEn = billing.taskSubmitted
        ? "The cloud may already have accepted this task. Check the existing task before resubmitting."
        : "This task was not submitted to the cloud, so you can retry after topping up.";
      const errorMessage = locale === "en"
        ? `${billing.providerLabel} has insufficient balance or credits. Top up the provider account. ${taskStateEn}`
        : `${billing.providerLabel} 账户余额或额度不足，请前往该平台充值。${taskStateZh}`;
      return NextResponse.json({
        error: errorMessage,
        code: "INSUFFICIENT_BALANCE",
        provider: billing.provider,
        providerLabel: billing.providerLabel,
        rechargeUrl: billing.rechargeUrl,
        taskSubmitted: billing.taskSubmitted,
      }, { status: 402 });
    }
    if (isContentPolicyRejection(error)) {
      const locale = req.headers.get("accept-language")?.toLowerCase().startsWith("en") ? "en" : "zh";
      return NextResponse.json({ error: contentPolicyError(locale, "video"), code: "CONTENT_POLICY" }, { status: 422 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "一键整片生成失败", "Storyboard film failed") },
      { status: 500 }
    );
  }
}

/** Download the generated film into the project's output dir and register it as a composition. */
async function persistFilm(
  projectId: string,
  videoUrl: string | undefined,
  model: string,
  resolution: GenResolution,
  aspectRatio: GenAspectRatio
) {
  if (!videoUrl) throw new Error("生成完成但未返回视频地址");
  const resp = await safeFetch(videoUrl);
  if (!resp.ok) throw new Error(`下载成片失败: ${resp.status}`);
  const buf = await readResponseBuffer(resp, MAX_FILM_BYTES, "成片");
  if (buf.byteLength === 0) throw new Error("生成成片为空");
  const outputDir = join(getDataDir(), "output", projectId);
  await mkdir(outputDir, { recursive: true });
  const fileName = `film_${Date.now()}.mp4`;
  const outputPath = join(outputDir, fileName);
  await writeFile(outputPath, buf);
  if (!(await validateOrDelete(outputPath, "video"))) throw new Error("生成成片文件损坏或格式不受支持");

  const probe = await probeMedia(outputPath).catch(() => undefined);
  const db = getDb();
  const [comp] = await db
    .insert(compositions)
    .values({
      projectId,
      outputPath,
      videoOrigin: "cloud_ai",
      resolution,
      aspectRatio,
      ...(probe?.duration ? { duration: Math.round(probe.duration * 1000) } : {}),
      // one-call native generation: no badge burned in — the release gate reports this honestly
      aigcBadge: false,
      label: `九宫格整片 · ${model.split("/").slice(0, 2).pop() ?? model}`.slice(0, 60),
      status: "done",
    })
    .returning();
  await db.update(projects).set({ status: "done", productionMode: "ai", updatedAt: new Date() }).where(eq(projects.id, projectId));
  return { url: `/api/output/${projectId}/${fileName}`, compositionId: comp.id, fileName };
}
