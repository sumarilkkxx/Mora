const POLICY_RE = /content management policy|content policy|safety policy|moderation|response was filtered|prompt.*filtered|内容审核|内容策略|安全策略/i;

export function isContentPolicyRejection(error: unknown): boolean {
  return POLICY_RE.test(error instanceof Error ? error.message : String(error ?? ""));
}

export function contentPolicyError(locale: "zh" | "en", stage: "image" | "video"): string {
  if (locale === "en") {
    return stage === "image"
      ? "The image provider rejected this storyboard under its content policy. Mora already removed purchase and text-overlay instructions; review the visual descriptions or reference image, then retry."
      : "The video provider rejected this film under its content policy. Review the shot descriptions, dialogue, and reference images, then retry.";
  }
  return stage === "image"
    ? "生图平台按内容策略拒绝了该分镜。Mora 已自动移除购买引导和文字叠加指令；如仍失败，请检查分镜画面描述或参考图后重试。"
    : "视频平台按内容策略拒绝了该成片。请检查分镜描述、台词和参考图后重试。";
}
