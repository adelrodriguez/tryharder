import type { BuilderConfig } from "../types/builder"
import type { TryCtx } from "../types/core"
import type { RetryOptions, RetryPolicy } from "../types/retry"
import { Panic } from "../errors"
import { assertUnreachable, invariant } from "../utils"

export function retryOptions(policy: RetryOptions): RetryPolicy {
  const limit = typeof policy === "number" ? policy : policy.limit

  invariant(Number.isFinite(limit), new Panic("RETRY_INVALID_LIMIT"))
  invariant(limit >= 0, new Panic("RETRY_INVALID_LIMIT"))

  if (typeof policy === "number") {
    return {
      backoff: "constant",
      delayMs: 0,
      limit: policy,
    }
  }

  const base = {
    delayMs: policy.delayMs ?? 0,
    jitter: policy.jitter,
    limit: policy.limit,
    shouldRetry: policy.shouldRetry,
  }

  switch (policy.backoff) {
    case "constant":
    case "linear":
      return { ...base, backoff: policy.backoff }
    case "exponential":
      return { ...base, backoff: policy.backoff, maxDelayMs: policy.maxDelayMs }
    default:
      return assertUnreachable(policy, "UNREACHABLE_RETRY_POLICY_BACKOFF")
  }
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
  ctx: TryCtx,
  config: BuilderConfig
): boolean {
  const policy = config.retry

  if (!policy) {
    return false
  }

  if (ctx.retry.attempt >= policy.limit) {
    return false
  }

  if (!policy.shouldRetry) {
    return true
  }

  return policy.shouldRetry(error, ctx)
}

export function checkIsRetryExhausted(attempt: number, config: BuilderConfig): boolean {
  return config.retry !== undefined && attempt >= config.retry.limit
}
