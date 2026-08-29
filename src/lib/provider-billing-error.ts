type ProviderErrorLike = {
  message?: unknown;
  code?: unknown;
  statusCode?: unknown;
  provider?: unknown;
  taskId?: unknown;
};

export interface InsufficientBalanceDetails {
  provider: string;
  providerLabel: string;
  rechargeUrl?: string;
  statusCode?: number;
  taskSubmitted: boolean;
}

const BILLING_PROVIDERS: Record<string, { label: string; rechargeUrl?: string }> = {
  openrouter: {
    label: "OpenRouter",
    rechargeUrl: "https://openrouter.ai/settings/credits",
  },
  "atlas-cloud": {
    label: "Atlas Cloud",
    rechargeUrl: "https://console.atlascloud.ai/billing",
  },
};

// Some providers incorrectly wrap insufficient-credit failures in HTTP 400. Keep the
// fallback narrow: a generic quota/rate-limit message is not necessarily a billing issue.
const INSUFFICIENT_BALANCE_PATTERN =
  /payment required|insufficient[\s_-]*(?:balance|credit|credits|funds)|(?:balance|credit|credits|funds)[\s_-]*(?:is[\s_-]*)?(?:insufficient|exhausted|depleted)|out of (?:credit|credits|funds)|余额不足|额度不足|余额已用尽|额度已用尽/i;

export function getBillingProviderInfo(provider: string) {
  const normalized = provider.trim().toLowerCase();
  return BILLING_PROVIDERS[normalized] ?? { label: provider || "AI 平台" };
}

export function insufficientBalanceDetails(
  error: unknown,
  fallbackProvider: string,
): InsufficientBalanceDetails | null {
  const candidate = error && typeof error === "object" ? (error as ProviderErrorLike) : {};
  const message = typeof candidate.message === "string" ? candidate.message : String(error ?? "");
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const statusCode = typeof candidate.statusCode === "number" ? candidate.statusCode : undefined;
  const insufficient = statusCode === 402 || INSUFFICIENT_BALANCE_PATTERN.test(`${code} ${message}`);
  if (!insufficient) return null;

  const provider = typeof candidate.provider === "string" && candidate.provider
    ? candidate.provider
    : fallbackProvider;
  const info = getBillingProviderInfo(provider);
  return {
    provider,
    providerLabel: info.label,
    rechargeUrl: info.rechargeUrl,
    statusCode,
    taskSubmitted: typeof candidate.taskId === "string" && candidate.taskId.length > 0,
  };
}
