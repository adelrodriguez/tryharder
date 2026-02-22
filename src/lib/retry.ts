import type { RetryPolicy } from "./types"

export function normalizeRetryPolicy(policy: number | RetryPolicy): RetryPolicy {
  if (typeof policy === "number") {
    return {
      backoff: "linear",
      delayMs: 0,
      limit: policy,
    }
  }

  return {
    backoff: policy.backoff ?? "linear",
    delayMs: policy.delayMs ?? 0,
    ...policy,
  }
}

export function retryOptions(policy: RetryPolicy): RetryPolicy {
  return normalizeRetryPolicy(policy)
}
