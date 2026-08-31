/**
 * Per-character voice assignment for dialogue scripts (drama style) — free multi-voice TTS.
 *
 * Edge TTS is keyless, so giving every character a distinct voice costs nothing; what matters is
 * that the assignment is DETERMINISTIC (recomposing the same script must reuse the same voices)
 * and that two characters never share a voice. Narrator shots (no characterId) keep the project's
 * default voice, so drama dialogue and the closing narration coexist naturally.
 *
 * Pure functions, unit-testable.
 */
import type { ScriptCharacter } from "@/lib/db/schema";

/**
 * Distinct-sounding zh-CN Edge voice pools. Order matters (assignment is positional per gender).
 * Xiaoxiao is deliberately NOT first in the female pool: it is the project-wide default narrator
 * voice, and a dialogue character sounding identical to the narrator kills the two-person illusion.
 */
const FEMALE_POOL = ["zh-CN-XiaoyiNeural", "zh-CN-liaoning-XiaobeiNeural", "zh-CN-shaanxi-XiaoniNeural"];
const MALE_POOL = ["zh-CN-YunxiNeural", "zh-CN-YunjianNeural", "zh-CN-YunyangNeural"];

/**
 * Assign a distinct Edge voice to each character (positional by gender, deterministic).
 * Returns characterId → voice id. Characters beyond a pool's size wrap around (voices repeat) —
 * the drama style caps the cast at 2-4, so wrapping is a degenerate case, not the norm.
 */
export function assignCharacterVoices(characters: ScriptCharacter[]): Map<string, string> {
  const out = new Map<string, string>();
  let f = 0;
  let m = 0;
  for (const c of characters) {
    if (!c?.id || out.has(c.id)) continue;
    if (c.gender === "male") {
      out.set(c.id, MALE_POOL[m % MALE_POOL.length]);
      m++;
    } else {
      out.set(c.id, FEMALE_POOL[f % FEMALE_POOL.length]);
      f++;
    }
  }
  return out;
}
