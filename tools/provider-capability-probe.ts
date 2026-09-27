import {
  PROVIDER_CAPABILITY_CONTRACT_VERSION,
  preflightCapabilityRequest,
  resolveCapabilityContract,
  type ProviderCapability,
} from "../src/lib/provider-capability-contract";

if (process.argv.includes("--live")) {
  throw new Error("真实 Provider 探针需要 Task 14 的凭证与费用预算授权；本命令默认且当前仅运行离线 fixture。");
}

const fixtures: Array<{ provider: string; modelId: string; capability: ProviderCapability; modes?: string[]; supportsAudio?: boolean }> = [
  { provider: "openrouter", modelId: "openai/gpt-5", capability: "text" },
  { provider: "openrouter", modelId: "openai/gpt-5", capability: "vision" },
  { provider: "openai", modelId: "openai/gpt-image-2", capability: "image", modes: ["text-to-image", "image-to-image"] },
  { provider: "openrouter", modelId: "google/veo3.1/image-to-video", capability: "video", modes: ["image-to-video"], supportsAudio: true },
  { provider: "atlas-cloud", modelId: "bytedance/seedance-2.5", capability: "video", supportsAudio: true },
  { provider: "replicate", modelId: "owner/custom-video", capability: "video", modes: ["text-to-video"] },
  { provider: "volcengine", modelId: "doubao-seedance-2-5-260628", capability: "video", modes: ["text-to-video", "image-to-video"], supportsAudio: true },
  { provider: "alibaba", modelId: "wan2.6-i2v", capability: "video", modes: ["image-to-video"] },
  { provider: "siliconflow", modelId: "black-forest-labs/FLUX.1-schnell", capability: "image", modes: ["text-to-image"] },
  { provider: "minimax", modelId: "speech-2.6-hd", capability: "tts" },
];

const results = fixtures.map((fixture) => {
  const contract = resolveCapabilityContract(fixture);
  if (contract.version !== PROVIDER_CAPABILITY_CONTRACT_VERSION) throw new Error(`契约版本不一致: ${fixture.provider}/${fixture.modelId}`);
  const mode = fixture.modes?.[0];
  const preflight = preflightCapabilityRequest(contract, { mode, speed: fixture.capability === "tts" ? 1 : undefined });
  if (!preflight.ok) throw new Error(`fixture 预检失败: ${fixture.provider}/${fixture.modelId}`);
  return {
    provider: contract.provider,
    modelId: contract.modelId,
    capability: contract.capability,
    confidence: contract.confidence,
    recovery: contract.task.recovery,
  };
});

process.stdout.write(`${JSON.stringify({ mode: "fixture", contractVersion: PROVIDER_CAPABILITY_CONTRACT_VERSION, checked: results.length, results }, null, 2)}\n`);
