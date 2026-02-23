import type { BuilderConfig } from "./types/builder"
import type { RetryOptions, RetryPolicy } from "./types/retry"
import { createContext } from "./context"
import { assertUnreachable } from "./utils"

export function normalizeRetryPolicy(policy: RetryOptions): RetryPolicy {
  if (typeof policy === "number") {
    return {
      backoff: "constant",
      delayMs: 0,
      limit: policy,
    }
  }

  switch (policy.backoff) {
    case "constant":
      return {
        backoff: "constant",
        delayMs: policy.delayMs ?? 0,
        jitter: policy.jitter,
        limit: policy.limit,
        shouldRetry: policy.shouldRetry,
      }
    case "linear":
      return {
        backoff: "linear",
        delayMs: policy.delayMs ?? 0,
        jitter: policy.jitter,
        limit: policy.limit,
        shouldRetry: policy.shouldRetry,
      }
    case "exponential":
      return {
        backoff: "exponential",
        delayMs: policy.delayMs ?? 0,
        jitter: policy.jitter,
        limit: policy.limit,
        maxDelayMs: policy.maxDelayMs,
        shouldRetry: policy.shouldRetry,
      }
    default:
      return assertUnreachable(policy)
  }
}

export function retryOptions(policy: RetryOptions): RetryPolicy {
  return normalizeRetryPolicy(policy)
}

export function calculateRetryDelay(attempt: number, config: BuilderConfig): number {
  const policy = config.retry

  if (!policy) {
    return 0
  }

  const baseDelay = policy.delayMs ?? 0
  let delay = 0

  switch (policy.backoff) {
    case "constant":
      delay = baseDelay
      break
    case "linear":
      delay = baseDelay * attempt
      break
    case "exponential":
      delay = baseDelay * 2 ** (attempt - 1)

      if (policy.maxDelayMs !== undefined) {
        delay = Math.min(delay, policy.maxDelayMs)
      }

      break
  }

  if (!policy.jitter || delay <= 0) {
    return delay
  }

  return Math.floor(Math.random() * delay)
}

export function checkShouldAttemptRetry(
  error: unknown,
  attempt: number,
  config: BuilderConfig
): boolean {
  const policy = config.retry

  if (!policy) {
    return false
  }

  if (attempt >= policy.limit) {
    return false
  }

  if (!policy.shouldRetry) {
    return true
  }

  const ctx = createContext(config)
  ctx.retry.attempt = attempt
  ctx.retry.limit = policy.limit

  return policy.shouldRetry(error, ctx)
}

export function checkIsRetryExhausted(attempt: number, config: BuilderConfig): boolean {
  return config.retry !== undefined && attempt >= config.retry.limit
}
