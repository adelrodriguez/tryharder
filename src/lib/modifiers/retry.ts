import type { BuilderConfig } from "../builder"
import type { TryCtx } from "../executors/shared"
import { Panic } from "../errors"
import { assertUnreachable, invariant } from "../utils"

interface BaseRetryPolicy {
  /**
   * Maximum number of attempts, including the first run.
   */
  limit: number
  /**
   * Delay in milliseconds between attempts. Defaults to 0.
   */
  delayMs?: number
  /**
   * Adds random jitter to delays when enabled.
   */
  jitter?: boolean
  /**
   * Return true to retry after an error, false to stop.
   */
  shouldRetry?: (error: unknown, ctx: TryCtx) => boolean
}

interface LinearBackoffRetryPolicy extends BaseRetryPolicy {
  /**
   * Use linearly increasing delay between attempts.
   */
  backoff: "linear"
  /**
   * Not supported for linear backoff.
   */
  maxDelayMs?: never
}

interface ExponentialBackoffRetryPolicy extends BaseRetryPolicy {
  /**
   * Use exponential delay growth between attempts.
   */
  backoff: "exponential"
  /**
   * Optional cap for exponential delay in milliseconds.
   */
  maxDelayMs?: number
}

/**
 * Retry policy using a constant delay strategy.
 */
interface ConstantBackoffRetryPolicy extends BaseRetryPolicy {
  /**
   * Required discriminant: use a fixed delay between attempts.
   */
  backoff: "constant"
  /**
   * Not supported for constant backoff.
   */
  maxDelayMs?: never
}

/**
 * Retry configuration object.
 */
export type RetryPolicy =
  | LinearBackoffRetryPolicy
  | ExponentialBackoffRetryPolicy
  | ConstantBackoffRetryPolicy

/**
 * Retry shorthand or full retry configuration.
 *
 * - `number`: attempt limit
 * - `RetryPolicy`: detailed retry settings
 */
export type RetryOptions = number | RetryPolicy

declare const INVALID_RETRY_LIMIT: unique symbol
type InvalidRetryLimit = {
  readonly [INVALID_RETRY_LIMIT]: "retry() requires a positive integer limit"
}

/**
 * Compile-time validation for literal retry limits. Rejects `0`, negative, and fractional literals;
 * non-literal `number` values pass and are validated at runtime by {@link retryOptions} instead.
 * (`Infinity`/`NaN` have no literal types, so they are runtime-only.)
 */
export type ValidateRetryLimit<N extends number> = number extends N
  ? number
  : `${N}` extends `-${string}` | `${string}.${string}`
    ? InvalidRetryLimit
    : N extends 0
      ? InvalidRetryLimit
      : number

export function retryOptions(policy: RetryOptions): RetryPolicy {
  const limit = typeof policy === "number" ? policy : policy.limit

  invariant(Number.isInteger(limit), new Panic("RETRY_INVALID_LIMIT"))
  invariant(limit >= 1, new Panic("RETRY_INVALID_LIMIT"))

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
