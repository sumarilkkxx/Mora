// Dedicated server-side ASR process: source audio remains local, only model weights download.
import { readFile, writeFile } from "node:fs/promises";
import { pipeline, env } from "@huggingface/transformers";
const [input, output, cache, language = "zh"] = process.argv.slice(2);
if (!input || !output || !cache) throw new Error("Missing ASR arguments");
env.cacheDir = cache;
const buffer = await readFile(input);
const audio = new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
const duration = audio.length / 16000;
function audible(start, end) {
  let sum = 0;
  const first = Math.max(0, Math.floor(start * 16000)), last = Math.min(audio.length, Math.ceil(end * 16000));
  for (let i = first; i < last; i++) sum += audio[i] ** 2;
  return last > first && Math.sqrt(sum / (last - first)) > 0.0001;
}
// Whisper may invent a closing phrase on pure silence. Do not promote it to speech evidence.
if (!audible(0, duration)) { await writeFile(output, "[]"); process.exit(0); }
const asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-base", { device: "cpu", dtype: "q8" });
const result = await asr(audio, { language: language === "en" ? "english" : "chinese", return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
const chunks = result.chunks ?? [];
await writeFile(output, JSON.stringify(chunks.map(c => ({ start: c.timestamp[0], end: Math.min(duration, c.timestamp[1] ?? duration), text: c.text.trim() })).filter(c => c.text && c.end > c.start && audible(c.start, c.end))));
await asr.dispose();
