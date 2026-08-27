const ASR_SAMPLE_RATE = 16_000;

/** Decode a browser-readable video/audio file and return mono 16 kHz PCM for local ASR. */
export async function decodeAudioForAsr(input: ArrayBuffer): Promise<Float32Array> {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("当前浏览器不支持音频解码");

  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(input.slice(0));
    if (!decoded.numberOfChannels || decoded.duration <= 0) throw new Error("素材中没有可转写的音轨");

    const frameCount = Math.max(1, Math.ceil(decoded.duration * ASR_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frameCount, ASR_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    await context.close().catch(() => {});
  }
}
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
