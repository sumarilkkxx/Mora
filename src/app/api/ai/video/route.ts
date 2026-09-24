import { NextRequest, NextResponse } from "next/server";
import { createProvider } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/base";
import { toRemoteUsableImage, resolveUploadFilePath } from "@/lib/remote-image";
import { apiError, errText } from "@/lib/api-error";
import { recordAiTask, updateAiTask } from "@/lib/ai-tasks";
import { normalizeVideoOptionsForModel } from "@/lib/normalize-video-options";
import { insufficientBalanceDetails } from "@/lib/provider-billing-error";
import type { VideoWorkflow } from "@/lib/providers/types";
import { persistDerivedImage } from "@/lib/derived-image";
import { getUploadsDir } from "@/lib/paths";
import { relative, sep } from "node:path";
import { ATLAS_VIDEO_FAMILIES, atlasVideoFamilyId } from "@/lib/atlas-video-models";
import { estimateVideoSpend, resolveVideoSpendCap } from "@/lib/video-spend";
import { videoRequestResolution } from "@/lib/storyboard-film";

const VIDEO_WORKFLOWS = new Set<VideoWorkflow>(["shot-motion", "storyboard-film", "reference-replication", "prompt-video"]);

// AI video generation.
//
// Two-phase flow (issue #16): submit the paid task, persist the provider task ID to
// ai_tasks IMMEDIATELY, then poll. A poll timeout/crash no longer loses the task —
// the error response carries the task ID and the row stays recoverable ("unknown"),
// so the client can resume via /api/ai/video/task instead of paying again.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { provider: providerName, model, prompt, imageUrl, lastImageUrl, mode, apiKey, baseUrl, options, projectId, shotId, referenceVideoUrls, referenceImageUrls, background, spendCapUsd, acknowledgeOverCap } = body;
  const workflow = VIDEO_WORKFLOWS.has(body.workflow) ? body.workflow as VideoWorkflow : undefined;

  if (!providerName || !model) {
    return apiError(req, "缺少必要参数", "Missing required parameters");
  }

  if (!apiKey) {
    return apiError(req, "缺少 API Key，请先在设置中配置对应平台", "Missing API Key, please configure the corresponding platform in settings first");
  }

  try {
    const provider = createProvider({ name: providerName, apiKey, baseUrl });

    // The UI preflight and paid submit share one normalization policy. This is deliberately
    // completed before media upload or provider submission so unsupported values cannot bill.
    const normalized = normalizeVideoOptionsForModel(model, options, Boolean(lastImageUrl));
    const normalizedDuration = Number(normalized.options.duration);
    const effectiveResolution = videoRequestResolution(
      Number(normalized.options.width),
      Number(normalized.options.height),
    );
    const atlasFamily = providerName === "atlas-cloud"
      ? ATLAS_VIDEO_FAMILIES.find((family) => family.id === atlasVideoFamilyId(model))
      : undefined;
    const estimate = estimateVideoSpend(
      atlasFamily?.pricePerSecond,
      normalizedDuration,
      effectiveResolution,
    );
    const cap = resolveVideoSpendCap(spendCapUsd);
    if (estimate && cap > 0 && estimate.maxUsd > cap && !acknowledgeOverCap) {
      return apiError(
        req,
        `预估花费最高 $${estimate.maxUsd.toFixed(2)}，超过单次上限 $${cap.toFixed(2)}。请降低分辨率或时长，或明确确认继续。`,
        `Estimated spend is up to $${estimate.maxUsd.toFixed(2)}, above the $${cap.toFixed(2)} per-run cap. Lower resolution or duration, or explicitly confirm to continue.`,
        409,
      );
    }

    const firstFrameUrl = await toRemoteUsableImage(imageUrl);
    // Keyframe chaining (Dreamina-style first/last frame): pin the clip's last frame to the next
    // shot's keyframe so the transition is generated inside the clip (seamless on hard concat)
    const lastFrameUrl = lastImageUrl && normalized.allowLastFrame ? await toRemoteUsableImage(lastImageUrl) : undefined;

    // Reference-to-video inputs (viral replication): reference IMAGES may travel as Base64
    // like first frames, but reference VIDEOS must be real URLs — local /api/files paths
    // are uploaded to the provider's temporary hosting first when the provider supports uploads
    let refVideos: string[] | undefined;
    let refImages: string[] | undefined;
    if (Array.isArray(referenceVideoUrls) && referenceVideoUrls.length > 0) {
      refVideos = [];
      for (const ref of referenceVideoUrls as string[]) {
        if (typeof ref !== "string" || !ref) continue;
        if (ref.startsWith("http")) {
          refVideos.push(ref);
          continue;
        }
        const localPath = resolveUploadFilePath(ref);
        if (!localPath || !provider.uploadLocalMedia) {
          return apiError(req, "参考视频不可用：需要可访问的视频地址", "Reference video unavailable: a reachable video URL is required");
        }
        refVideos.push(await provider.uploadLocalMedia(localPath));
      }
    }
    if (Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0) {
      refImages = (await Promise.all((referenceImageUrls as string[]).map(toRemoteUsableImage))).filter(
        (u): u is string => !!u
      );
    }

    const videoOptions = {
      modelId: model,
      mode: mode || (imageUrl ? "image-to-video" : "text-to-video"),
      workflow,
      prompt: prompt || "",
      firstFrameUrl,
      ...(lastFrameUrl && { lastFrameUrl }),
      ...(refVideos?.length && { referenceVideoUrls: refVideos }),
      ...(refImages?.length && { referenceImageUrls: refImages }),
      ...normalized.options,
    };

    // legacy single-phase path for providers without two-phase task support
    if (!provider.submitVideoTask || !provider.waitForTask) {
      const result = await provider.generateVideo(videoOptions);
      return NextResponse.json(result);
    }

    // Phase 1: submit. Mode/model capability is validated inside the provider BEFORE any
    // billable call; base.request() never auto-retries this POST on timeout (money safety).
    let keyframePath: string | undefined;
    if (firstFrameUrl && projectId && Number.isInteger(shotId)) {
      if (!/^[a-zA-Z0-9-]+$/.test(projectId)) return apiError(req, "项目 ID 无效", "Invalid project ID");
      // Snapshot the exact first frame sent to the provider before the billable call.
      const localFrame = await persistDerivedImage(projectId, firstFrameUrl, `keyframe-${crypto.randomUUID()}`);
      keyframePath = `/api/files/${relative(getUploadsDir(), localFrame).split(sep).join("/")}`;
      videoOptions.firstFrameUrl = await toRemoteUsableImage(keyframePath);
    }
    const startTime = Date.now();
    const { taskId, modelId } = await provider.submitVideoTask(videoOptions);

    // Persist the paid task before polling starts — this row is the recovery handle.
    const rowId = await recordAiTask({
      projectId,
      shotId,
      provider: providerName,
      model: modelId,
      mediaType: "video",
          mode: workflow ?? videoOptions.mode,
      prompt: videoOptions.prompt,
      taskId,
      keyframePath,
    });
    if (!rowId) {
      return NextResponse.json({
        error: errText(
          req,
          `云端任务已提交，但恢复记录保存失败。请立即保存任务 ID ${taskId}，不要重复提交。`,
          `The cloud task was submitted, but its recovery record could not be saved. Save task ID ${taskId} now and do not resubmit.`,
        ),
        taskId,
        modelId,
        persistenceFailed: true,
        recoverable: false,
      }, { status: 503 });
    }

    // Background mode ends the paid submit request here. The global task center owns
    // status checks and final persistence, so navigation or closing this page cannot
    // interrupt retrieval and users never need to stare at a spinner for minutes.
    if (background) {
      return NextResponse.json({ taskId, modelId, status: "submitted", queued: true, recoverable: true, adjustments: normalized.adjustments, routing: { workflow, configuredModel: model, submittedModel: modelId } }, { status: 202 });
    }

    // Phase 2: wait. Transient status-query failures are tolerated inside waitForTask;
    // if it still fails, the task is marked "unknown"/"failed" but never dropped.
    try {
      const finalStatus = await provider.waitForTask(taskId, { interval: 5000 });
      const result = finalStatus.result;
      const videoUrls = result && "videoUrls" in result ? result.videoUrls : undefined;
      if (!videoUrls || videoUrls.length === 0) {
        await updateAiTask(rowId, { status: "unknown", error: "任务完成但未返回视频地址" });
        return NextResponse.json(
          { error: errText(req, "任务完成但未返回视频地址", "Task completed but returned no video URL"), taskId, modelId, recoverable: true },
          { status: 502 }
        );
      }
      await updateAiTask(rowId, { status: "completed", resultUrls: videoUrls, error: null });
      return NextResponse.json({
        taskId,
        videoUrls,
        modelId,
        duration: typeof normalized.options.duration === "number" ? normalized.options.duration : undefined,
        processingTime: Date.now() - startTime,
        hasAudio: normalized.options.audioEnabled === true,
        adjustments: normalized.adjustments,
        routing: { workflow, configuredModel: model, submittedModel: modelId },
      });
    } catch (error) {
      // definitive provider-side failure vs. lost contact (task may still be running & billed)
      const failed = error instanceof ProviderError && error.code === "TASK_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      await updateAiTask(rowId, { status: failed ? "failed" : "unknown", error: message });
      return NextResponse.json(
        {
          error: failed
            ? message
            : errText(
                req,
                `${message}。任务 ID ${taskId} 已保存，可在素材页恢复查询，请勿重复提交`,
                `${message}. Task ID ${taskId} has been saved and can be recovered from the assets page — do not resubmit`
              ),
          taskId,
          modelId,
          recoverable: !failed,
        },
        { status: failed ? 500 : 504 }
      );
    }
  } catch (error) {
    console.error("生视频失败:", error);
    const billing = insufficientBalanceDetails(error, providerName || "");
    if (billing) {
      console.warn("[AI_VIDEO_INSUFFICIENT_BALANCE]", {
        provider: billing.provider,
        model,
        statusCode: billing.statusCode ?? 402,
        taskSubmitted: billing.taskSubmitted,
      });
      const taskStateZh = billing.taskSubmitted
        ? "云端可能已经受理该任务，请先查询已有任务，不要重复提交"
        : "本次任务未提交到云端，充值后可重新生成";
      const taskStateEn = billing.taskSubmitted
        ? "The cloud may already have accepted this task. Check the existing task before resubmitting"
        : "This task was not submitted to the cloud. You can retry after topping up";
      return NextResponse.json(
        {
          error: errText(
            req,
            `${billing.providerLabel} 账户余额或额度不足，请前往该平台充值。${taskStateZh}。`,
            `${billing.providerLabel} has insufficient balance or credits. Top up the provider account. ${taskStateEn}.`,
          ),
          code: "INSUFFICIENT_BALANCE",
          provider: billing.provider,
          providerLabel: billing.providerLabel,
          rechargeUrl: billing.rechargeUrl,
          taskSubmitted: billing.taskSubmitted,
        },
        { status: 402 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "生视频失败", "Video generation failed") },
      { status: 500 }
    );
  }
}
