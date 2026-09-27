import { isContentPolicyRejection } from "@/lib/content-policy-error";
import { insufficientBalanceDetails } from "@/lib/provider-billing-error";

export type ProviderErrorCategory =
  | "authentication"
  | "billing"
  | "rate_limit"
  | "capability_mismatch"
  | "content_policy"
  | "queue_timeout"
  | "network_retryable"
  | "provider_failure";

export interface ClassifiedProviderError {
  category: ProviderErrorCategory;
  code: string;
  provider: string;
  message: string;
  httpStatus: number;
  retryable: boolean;
  recoverableTask: boolean;
  taskId?: string;
  rechargeUrl?: string;
}

type ErrorLike = {
  message?: unknown;
  code?: unknown;
  statusCode?: unknown;
  provider?: unknown;
  taskId?: unknown;
};

export function classifyProviderError(error: unknown, fallbackProvider: string): ClassifiedProviderError {
  const candidate = error && typeof error === "object" ? error as ErrorLike : {};
  const message = typeof candidate.message === "string" ? candidate.message : String(error ?? "Provider request failed");
  const sourceCode = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  const statusCode = typeof candidate.statusCode === "number" ? candidate.statusCode : undefined;
  const provider = typeof candidate.provider === "string" && candidate.provider ? candidate.provider : fallbackProvider;
  const taskId = typeof candidate.taskId === "string" && candidate.taskId ? candidate.taskId : undefined;
  const billing = insufficientBalanceDetails(error, provider);

  let category: ProviderErrorCategory;
  let retryable = false;
  let httpStatus = statusCode ?? 500;
  if (statusCode === 401 || statusCode === 403 || /(?:unauthori[sz]ed|invalid|expired|revoked).*(?:key|token)|(?:key|token).*(?:invalid|expired|revoked)/i.test(message)) {
    category = "authentication";
    httpStatus = 401;
  } else if (billing) {
    category = "billing";
    httpStatus = 402;
  } else if (statusCode === 429 || sourceCode === "RATE_LIMIT" || /rate.?limit|too many requests/i.test(message)) {
    category = "rate_limit";
    retryable = true;
    httpStatus = 429;
  } else if (/^UNSUPPORTED_|CAPABILITY|INVALID_(?:MODE|DURATION|RESOLUTION|RATIO|REFERENCE)/.test(sourceCode) || /unsupported (?:mode|duration|resolution|ratio|reference|parameter)/i.test(message)) {
    category = "capability_mismatch";
    httpStatus = 422;
  } else if (isContentPolicyRejection(error)) {
    category = "content_policy";
    httpStatus = 422;
  } else if (["POLL_TIMEOUT", "STATUS_UNKNOWN", "TIMEOUT", "QUEUE_TIMEOUT"].includes(sourceCode) || statusCode === 408 || statusCode === 504) {
    category = "queue_timeout";
    retryable = true;
    httpStatus = 504;
  } else if (sourceCode === "NETWORK_ERROR" || (statusCode != null && statusCode >= 500)) {
    category = "network_retryable";
    retryable = true;
    httpStatus = 503;
  } else {
    category = "provider_failure";
  }

  return {
    category,
    code: category.toUpperCase(),
    provider,
    message,
    httpStatus,
    retryable,
    recoverableTask: Boolean(taskId) && (category === "queue_timeout" || category === "network_retryable" || category === "billing"),
    ...(taskId && { taskId }),
    ...(billing?.rechargeUrl && { rechargeUrl: billing.rechargeUrl }),
  };
}
