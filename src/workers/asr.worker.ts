/// <reference lib="webworker" />

import { env, pipeline, type AutomaticSpeechRecognitionOutput } from "@huggingface/transformers";
import type { AsrWorkerMessage, AsrWorkerRequest, LocalAsrDevice, LocalAsrModel } from "@/lib/local-asr";
import {
  detectSilenceRanges,
  segmentsFromWords,
  type TranscriptDocument,
  type TranscriptWord,
} from "@/lib/transcript-editor";

const worker = self as unknown as DedicatedWorkerGlobalScope;
const pipelines = new Map<string, Awaited<ReturnType<typeof pipeline<"automatic-speech-recognition">>>>();

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.useWasmCache = true;

function post(message: AsrWorkerMessage): void {
  worker.postMessage(message);
}

function progressValue(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as { progress?: unknown; status?: unknown };
  if (raw.status === "ready") return 100;
  const value = Number(raw.progress);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

async function loadPipeline(model: LocalAsrModel, device: LocalAsrDevice) {
  const key = `${model}:${device}`;
  const cached = pipelines.get(key);
  if (cached) return cached;
  const transcriber = await pipeline("automatic-speech-recognition", model, {
    device,
    // Keep the WebGPU encoder in fp32 for broad adapter support while quantizing the much
    // larger autoregressive decoder; WASM uses q8 throughout. This cuts first-use download and
    // memory substantially without forcing optional shader-f16 support.
    dtype: device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
    progress_callback: (data) => {
      const progress = progressValue(data);
      if (progress !== null) post({ type: "progress", phase: "loading", progress });
    },
  });
  pipelines.set(key, transcriber);
  return transcriber;
}

function wordsFromOutput(output: AutomaticSpeechRecognitionOutput): TranscriptWord[] {
  return (output.chunks ?? []).flatMap((chunk, index) => {
    const text = String(chunk.text ?? "").replace(/\s+/g, " ").trim();
    const start = Number(chunk.timestamp?.[0]);
    const end = Number(chunk.timestamp?.[1]);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ id: `w${index + 1}`, text, start: Math.max(0, start), end: Math.max(0, end) }];
  });
}

async function transcribe(request: AsrWorkerRequest, device: LocalAsrDevice): Promise<TranscriptDocument> {
  post({ type: "device", device });
  const transcriber = await loadPipeline(request.model, device);
  post({ type: "progress", phase: "transcribing", progress: 5 });
  const output = await transcriber(request.audio, {
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 5,
    force_full_sequences: false,
    task: "transcribe",
    ...(request.language && request.language !== "auto" ? { language: request.language } : {}),
  });
  const result = Array.isArray(output) ? output[0] : output;
  const words = wordsFromOutput(result);
  if (!words.length) throw new Error("没有识别到可编辑的语音内容");
  const duration = request.audio.length / 16_000;
  return {
    version: 1,
    text: result.text.trim() || words.map((word) => word.text).join(" "),
    language: request.language || "auto",
    duration,
    model: request.model,
    device,
    words,
    segments: segmentsFromWords(words),
    silenceRanges: detectSilenceRanges(request.audio, 16_000),
    createdAt: new Date().toISOString(),
  };
}

worker.addEventListener("message", async (event: MessageEvent<AsrWorkerRequest>) => {
  if (event.data?.type !== "transcribe") return;
  const request = event.data;
  try {
    const canUseWebGpu = request.preferWebGpu && "gpu" in navigator;
    try {
      const transcript = await transcribe(request, canUseWebGpu ? "webgpu" : "wasm");
      post({ type: "progress", phase: "transcribing", progress: 100 });
      post({ type: "complete", transcript });
    } catch (error) {
      if (!canUseWebGpu) throw error;
      post({ type: "device", device: "wasm", fallback: true });
      const transcript = await transcribe(request, "wasm");
      post({ type: "progress", phase: "transcribing", progress: 100 });
      post({ type: "complete", transcript });
    }
  } catch (error) {
    post({ type: "error", error: error instanceof Error ? error.message : "本地转写失败" });
  }
});

export {};
