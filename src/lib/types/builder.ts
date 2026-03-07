import type { TryCtx } from "./core"
import type { RetryPolicy } from "./retry"
import type { RunTryFn } from "./run"

/**
 * Known limitation: wrappers currently receive the full TryCtx shape.
 * This keeps middleware signatures stable while run() input
 * contexts are feature-narrowed.
 */
export type WrapFn = (ctx: TryCtx, next: RunTryFn<unknown, TryCtx>) => unknown

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
