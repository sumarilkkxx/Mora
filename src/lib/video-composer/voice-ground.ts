/**
 * Voice grounding — makes TTS narration sit in a real room instead of a digital vacuum.
 *
 * The two loudest TTS tells (2026 audio-realism survey) are the "studio-clean" voice band and
 * the absolute digital silence between sentences — real phone recordings always carry a noise
 * floor and the mic's AGC/cheap-driver signature. Two pure pieces:
 *
 *  - `VOICE_GROUND_CHAIN`: per-TTS-stream de-broadcast chain — narrow the response to a phone-mic
 *    band (HP 90 / LP 9500), AGC-style 3:1 compression, and a light high-frequency exciter (the
 *    harmonic edge cheap mics add). Applied ONLY to TTS files; native model audio (Seedance 2.x
 *    speaks with its own room tone) must never pass through this chain.
 *  - `roomToneSource()`: a synthetic room-tone bed (brown noise, low-passed to an HVAC-like
 *    rumble) mixed under the whole timeline so inter-sentence gaps never drop to digital zero.
 *
 * Pure strings/functions, no I/O — the composer splices them into its filter graph.
 */

/** Per-TTS-stream de-broadcast chain (insert after aresample, before apad/atrim). */
export const VOICE_GROUND_CHAIN =
  "highpass=f=90,lowpass=f=9500," +
  "acompressor=threshold=-18dB:ratio=3:attack=20:release=250:makeup=2," +
  "aexciter=amount=2:drive=8.5:freq=6000";

/**
 * Room-tone bed source (lavfi, no asset file needed): brown noise at a barely-there level,
 * low-passed so it reads as room/air-conditioning rumble rather than hiss; forced to the
 * graph's 44100/stereo format so amix accepts it. The amplitude sits in the "unnoticed until
 * removed" band; the final loudnorm pass keeps it well under the narration.
 */
export function roomToneSource(amplitude = 0.008): string {
  return (
    `anoisesrc=colour=brown:r=44100:amplitude=${amplitude},` +
    `lowpass=f=400,aformat=sample_rates=44100:channel_layouts=stereo`
  );
}
