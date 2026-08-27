/**
 * Semantic footage rerank — one batched LLM call picks the stock candidate that best matches each
 * shot's narration, replacing pure keyword-overlap ranking when an LLM is configured (opt-in).
 *
 * Why (2026 survey): "the footage has nothing to do with the script" is the single loudest complaint
 * against auto-fill pipelines in this category. Keyword overlap can't tell "coffee brewing at home"
 * footage from "coffee shop exterior"; a small LLM judgment over titles/tags can.
 *
 * Designed for the keyless path too: ONE request for the whole fill (Pollinations anonymous tier
 * allows a single queued request per IP), tiny JSON output. Any failure falls back to the heuristic —
 * semantic rerank must never break auto-fill.
 */
import { reasoningParams } from "@/lib/script-engine/generator";
import { createLLMClient, withLLMErrors } from "@/lib/llm-error";
import { stripThinkBlocks } from "@/lib/llm-clean";

export interface SemanticLLMConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface RerankShot {
  shotId: number;
  /** what the shot narrates/shows (voiceover preferred, falls back to visual description) */
  text: string;
  /** candidate summaries, index-aligned with the caller's candidate list (capped by the caller) */
  candidates: { title?: string; tags?: string[]; source?: string }[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Build the batched rerank prompt: all shots + numbered candidates → strict JSON picks. Pure function. */
export function buildRerankPrompt(shots: RerankShot[]): string {
  const blocks = shots.map((s) => {
    const cands = s.candidates
      .map((c, i) => {
        const bits = [c.title ? clip(c.title, 60) : "(untitled)"];
        if (c.tags?.length) bits.push(`tags: ${clip(c.tags.slice(0, 6).join(", "), 80)}`);
        if (c.source) bits.push(c.source);
        return `  ${i}. ${bits.join(" | ")}`;
      })
      .join("\n");
    return `镜头 ${s.shotId}（内容：${clip(s.text, 80)}）候选素材：\n${cands}`;
  });
  return [
    "你是短视频剪辑师。为每个镜头从候选素材里选一个画面最贴合镜头内容的（看标题/标签的语义，不是字面重合）。",
    "",
    blocks.join("\n\n"),
    "",
    '只输出 JSON 数组，不要解释，格式：[{"shotId":镜头号,"pick":候选序号}]，每个镜头一项。',
  ].join("\n");
}

/**
 * Parse the LLM reply into shotId → candidate index. Invalid entries (unknown shot, out-of-range
 * pick) are dropped rather than failing the batch; returns null only when nothing usable parses.
 * Pure function.
 */
export function parseRerankPicks(text: string, shots: RerankShot[]): Map<number, number> | null {
  if (!text) return null;
  // Reasoning models may prepend a <think> trace whose braces/brackets would fool the slicing below
  text = stripThinkBlocks(text);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const byId = new Map(shots.map((s) => [s.shotId, s]));
  const picks = new Map<number, number>();
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const { shotId, pick } = item as { shotId?: unknown; pick?: unknown };
    if (typeof shotId !== "number" || typeof pick !== "number" || !Number.isInteger(pick)) continue;
    const shot = byId.get(shotId);
    if (!shot || pick < 0 || pick >= shot.candidates.length) continue;
    picks.set(shotId, pick);
  }
  return picks.size > 0 ? picks : null;
}

/** One batched LLM call → validated picks. Throws on request/parse failure (caller falls back to heuristic). */
export async function rerankShotCandidates(shots: RerankShot[], cfg: SemanticLLMConfig): Promise<Map<number, number>> {
  const rankable = shots.filter((s) => s.candidates.length > 1);
  if (rankable.length === 0) return new Map();
  // shared factory: placeholder key for keyless endpoints, SDK retries + free-pool 402 retry
  const client = createLLMClient(cfg);
  const res = await withLLMErrors(
    () =>
      client.chat.completions.create({
        model: cfg.model,
        messages: [{ role: "user", content: buildRerankPrompt(rankable) }],
        temperature: 0,
        ...reasoningParams(cfg.baseUrl),
      }),
    cfg,
  );
  const picks = parseRerankPicks(res.choices?.[0]?.message?.content ?? "", rankable);
  if (!picks) throw new Error("语义配片解析失败（LLM 未返回可用的 JSON picks）");
  return picks;
}
