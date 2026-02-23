import type { TryCtx } from "./core"
import type { RetryPolicy } from "./retry"
import type { RunTryFn } from "./run"

export interface TimeoutPolicy {
  /**
   * Timeout in milliseconds.
   */
  ms: number
  /**
   * Timeout scope. Currently only total execution is supported.
   */
  scope: "total"
}

/**
 * Timeout shorthand or full timeout configuration.
 *
 * - `number`: timeout in milliseconds
 * - `TimeoutPolicy`: detailed timeout settings
 */
export type TimeoutOptions = number | TimeoutPolicy

export type WrapFn = (ctx: TryCtx, next: RunTryFn<unknown>) => unknown

export interface BuilderConfig {
  /**
   * Retry configuration applied to the run.
   */
  retry?: RetryPolicy
  /**
   * Timeout configuration applied to the run.
   */
  timeout?: TimeoutPolicy
  /**
   * Abort signal used to cancel execution.
   */
  signal?: AbortSignal
  /**
   * Wrapper middleware chain around execution.
   */
  wraps?: WrapFn[]
}

export type TaskMap = Record<string, (this: unknown) => unknown>
