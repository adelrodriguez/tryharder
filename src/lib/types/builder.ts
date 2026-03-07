import type { TryCtx } from "./core"
import type { RetryPolicy } from "./retry"

/**
 * Wraps are observational hooks: they can inspect execution context and
 * surround execution, but they must not mutate context or replace it.
 */
export type WrapCtx = Readonly<Omit<TryCtx, "retry">> & {
  readonly retry: Readonly<TryCtx["retry"]>
}

export type WrapFn = (ctx: WrapCtx, next: () => unknown) => unknown

export interface BuilderConfig {
  /**
   * Retry configuration applied to the run.
   */
  retry?: RetryPolicy
  /**
   * Timeout configuration applied to the run.
   */
  timeout?: number
  /**
   * Abort signals used to cancel execution.
   */
  signals?: AbortSignal[]
  /**
   * Wrapper middleware chain around execution.
   */
  wraps?: WrapFn[]
}
