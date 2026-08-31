/**
 * Strip reasoning-model "thinking" blocks from LLM output before JSON parsing.
 *
 * Reasoning models (DeepSeek R1-style, Qwen3 thinking, GLM-Z1, …) may prepend their chain of
 * thought wrapped in <think>…</think> (or <reasoning>/<thought> variants) to the visible content.
 * That text routinely contains braces and code fences, which corrupts every downstream
 * "find the JSON in the reply" heuristic — this bit us once already (DeepSeek v3.2 thinking text
 * dirtied the script JSON and forced a default-model migration). Since users bring their own key
 * and can pick any thinking model, the parse layer needs a mechanical defense, not a model ban.
 * Covers unclosed blocks from truncated output as well.
 */

/** Opening tags we treat as reasoning traces. Kept narrow: matching too much risks eating real content. */
const THINK_TAG = /<(think|thinking|reasoning|thought)\b[^>]*>/i;

/** Fully closed reasoning blocks, non-greedy so multiple blocks are each removed. */
const CLOSED_BLOCKS = /<(think|thinking|reasoning|thought)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** An unclosed opening tag swallows everything to the end (typical of output truncated mid-thought). */
const UNCLOSED_BLOCK = /<(think|thinking|reasoning|thought)\b[^>]*>[\s\S]*$/i;

/**
 * Remove reasoning blocks from an LLM reply.
 * If stripping leaves nothing (e.g. the model forgot the closing tag and wrote the JSON inside
 * the block), the original text is returned so the caller's parser still gets a chance — the
 * cleanup must never turn a recoverable reply into an empty one.
 */
export function stripThinkBlocks(text: string): string {
  if (!text || !THINK_TAG.test(text)) return text;
  const cleaned = text.replace(CLOSED_BLOCKS, "").replace(UNCLOSED_BLOCK, "").trim();
  return cleaned || text;
}
