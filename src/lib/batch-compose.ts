/** A lost status response is uncertainty, never permission to submit another render. */
export async function waitForBatchComposition(
  projectId: string,
  compositionId: string,
  cancelled: () => boolean,
  options: { fetcher?: typeof fetch; sleep?: () => Promise<void>; attempts?: number } = {},
): Promise<"done" | "failed" | "cancelled"> {
  const fetcher = options.fetcher ?? fetch;
  for (let i = 0; i < (options.attempts ?? 360); i++) {
    if (cancelled()) return "cancelled";
    const response = await fetcher(`/api/project/${encodeURIComponent(projectId)}/compose?compositionId=${encodeURIComponent(compositionId)}`);
    if (!response.ok) throw new Error(`合成状态查询失败 (${response.status})，请稍后恢复已有任务`);
    const data = await response.json();
    if (cancelled()) return "cancelled";
    const status = data?.composition?.status;
    if (status === "done" || status === "failed") return status;
    if (status !== "composing" && status !== "pending") throw new Error("无法确认已有合成状态，请稍后恢复任务");
    await (options.sleep ?? (() => new Promise((resolve) => setTimeout(resolve, 2500))))();
  }
  throw new Error("合成仍在进行，请稍后恢复已有任务");
}
