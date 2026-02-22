import type { TryCtx } from "./core"

export interface BaseRetryPolicy {
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

export interface LinearBackoffRetryPolicy extends BaseRetryPolicy {
  /**
   * Use linearly increasing delay between attempts.
   */
  backoff: "linear"
  /**
   * Not supported for linear backoff.
   */
  maxDelayMs?: never
}

export interface ExponentialBackoffRetryPolicy extends BaseRetryPolicy {
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
export interface ConstantBackoffRetryPolicy extends BaseRetryPolicy {
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
