/**
 * Voice markup — the script's [pause] breath marker.
 *
 * The script LLM may place ONE [pause] per shot at a natural breath point.
 * Exactly one consumer renders it (the free Edge TTS path converts it into an
 * SSML break — a real 350ms breath); every other consumer must strip it:
 * captions/karaoke (viewers must never read it), paid TTS engines (they would
 * try to speak it), speech-length estimation, and the Seedance native-voice
 * film prompt (the model speaks lines verbatim).
 *
 * Pure functions, no I/O.
 */

/** The breath marker as written by the script LLM (case-insensitive). */
export const PAUSE_MARK_RE = /\[pause\]/gi;

/**
 * Remove all [pause] markers for text-facing consumers. Collapses the doubled
 * spaces a removed marker leaves between Latin words; CJK text needs no glue.
 */
export function stripPauseMarks(text: string): string {
  return text.replace(PAUSE_MARK_RE, "").replace(/ {2,}/g, " ").trim();
}

/** True when the text carries at least one breath marker. */
export function hasPauseMarks(text: string): boolean {
  PAUSE_MARK_RE.lastIndex = 0;
  return PAUSE_MARK_RE.test(text);
}
