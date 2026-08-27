/**
 * Emotion-acting process library — embodied "process, not verdict" performance phrases.
 *
 * Why this exists: prompts that name an emotional END STATE ("she looks sad", "excited
 * face") push video models toward frozen theatrical masks — the single most common
 * acting tell. Real performances read as a PROCESS: something triggers, the body
 * registers it first (breath, shoulders, lean), and the face reacts last and stays
 * restrained. This module maps each commerce beat (shot type) to its default emotional
 * register and provides short process phrases across four body zones (eyes / mouth /
 * breath-neck / shoulders) that read as lived behavior instead of a posed expression.
 *
 * Consumers:
 *  - motion-prompt.ts: appends one process phrase to i2v prompts for non-talking
 *    person shots (talking shots already carry their own behavior-beat direction).
 *  - tts.ts / compose route: `shotEmotion` doubles as the per-shot default for
 *    expressive-TTS emotion parameters (providers that support one).
 *
 * Pure data + pure functions, no I/O.
 */

/** The emotional registers a commerce short actually uses (deliberately small). */
export type ActingEmotion = "eager" | "troubled" | "curious" | "focused" | "delighted" | "confident";

/** Shot type → the default emotional register of that beat in a commerce short. */
const SHOT_EMOTION: Record<string, ActingEmotion> = {
  hook: "eager",
  pain_point: "troubled",
  product_reveal: "curious",
  demo: "focused",
  social_proof: "delighted",
  cta: "confident",
};

/** Default emotional register for a shot type (undefined for unknown types). */
export function shotEmotion(shotType: string | undefined): ActingEmotion | undefined {
  return SHOT_EMOTION[String(shotType ?? "")];
}

/**
 * Process phrases per register. Every phrase is written as trigger → body-first →
 * restrained face, and NEVER names the end state ("sad", "thrilled") — end-state
 * words are exactly what freezes the model into a mask.
 */
const EMOTION_PROCESS: Record<ActingEmotion, { zh: string; en: string }[]> = {
  eager: [
    { zh: "眼睛先亮起来，身体不自觉往前倾了一点", en: "the eyes light up first, the body leaning in slightly without meaning to" },
    { zh: "呼吸略微加快，话比表情先到，嘴角才慢慢跟上", en: "breath quickens a touch, words arriving before the expression, the smile catching up slowly" },
  ],
  troubled: [
    { zh: "眉心先皱了一下，视线落到别处，肩膀轻轻塌下来", en: "the brow tightens first, gaze drifting away as the shoulders sink a little" },
    { zh: "嘴唇抿住半秒，鼻腔里一声几乎听不见的叹气", en: "lips press together for half a second, a barely audible sigh through the nose" },
  ],
  curious: [
    { zh: "头微微一偏，眼神先于身体凑近细看", en: "the head tilts slightly, the eyes moving in to inspect before the body follows" },
    { zh: "眉毛轻轻一挑，手上的动作放慢下来", en: "an eyebrow lifts a touch as the hands slow down" },
  ],
  focused: [
    { zh: "视线锁在手上的动作，呼吸放缓，肩颈安定不动", en: "eyes locked on the hands at work, breathing slowed, shoulders and neck settled" },
    { zh: "眼神专注跟着动作走，偶尔轻轻点一下头", en: "the gaze follows the motion intently, with an occasional small nod" },
  ],
  delighted: [
    { zh: "先是眼角放松下来，笑意才慢慢爬上嘴角", en: "the corners of the eyes soften first, the smile arriving slowly after" },
    { zh: "肩膀松下来，整个人往后轻轻一靠", en: "the shoulders release as the whole body eases back a little" },
  ],
  confident: [
    { zh: "下巴微收，视线稳稳落在镜头上，不急不缓", en: "chin slightly tucked, gaze settling steadily on the camera, unhurried" },
    { zh: "肩膀打开坐正，手掌向下轻轻一压", en: "shoulders open and squared, one palm pressing gently downward" },
  ],
};

/**
 * One process phrase for the register, rotated deterministically by seed (batch runs
 * must not repeat the same body language across every shot — repetition reads as AI).
 */
export function emotionActingLine(emotion: ActingEmotion, seed: number, lang: "zh" | "en"): string {
  const pool = EMOTION_PROCESS[emotion];
  const i = ((Math.floor(seed) % pool.length) + pool.length) % pool.length;
  return pool[i][lang];
}

/**
 * Expressive-TTS mapping per register:
 *  - minimax: MiniMax T2A voice_setting.emotion enum value (whitelisted again in tts.ts)
 *  - instruction: a natural-language delivery note for OpenAI-style TTS models that
 *    accept an `instructions` parameter
 * Registers whose delivery is effectively neutral map to "neutral" — sending a forced
 * emotion where none is wanted sounds worse than sending nothing.
 */
export const EMOTION_TTS: Record<ActingEmotion, { minimax: string; instruction: string }> = {
  eager: { minimax: "happy", instruction: "语气急切带一点兴奋，像忍不住要分享" },
  troubled: { minimax: "sad", instruction: "语气困扰无奈，像跟朋友吐槽" },
  curious: { minimax: "surprised", instruction: "语气好奇带一点意外，像刚发现什么" },
  focused: { minimax: "neutral", instruction: "语气平稳专注，像边做边讲" },
  delighted: { minimax: "happy", instruction: "语气松弛满足，像真的用得很舒服" },
  confident: { minimax: "neutral", instruction: "语气笃定干脆，不催促" },
};
