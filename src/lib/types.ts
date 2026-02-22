export type MaybePromise<T> = T | Promise<T>

export type ErrorCode =
  | "EXEC_CANCELLED"
  | "EXEC_TIMEOUT"
  | "EXEC_RETRY_EXHAUSTED"
  | "EXEC_UNHANDLED_EXCEPTION"
  | "EXEC_PANIC"

export interface RetryInfo {
  attempt: number
  limit: number
}

export interface TryCtx {
  signal?: AbortSignal
  retry: RetryInfo
}

export type RunTryFn<T> = (ctx: TryCtx) => T
export type RunCatchFn<E> = (error: unknown) => E

export interface RunWithCatchOptions<T, E> {
  try: RunTryFn<T>
  catch: RunCatchFn<E>
}

export type RunInput<T, E> = RunTryFn<T> | RunWithCatchOptions<T, E>

export interface RetryPolicy {
  limit: number
  delayMs?: number
  backoff?: "linear" | "exponential"
  maxDelayMs?: number
  jitter?: boolean
  shouldRetry?: (error: unknown, ctx: TryCtx) => boolean
}

export interface TimeoutOptions {
  ms: number
  scope: "total"
}

export type WrapFn = (ctx: TryCtx, next: RunTryFn<unknown>) => unknown

export interface BuilderConfig {
  retry?: RetryPolicy
  timeout?: TimeoutOptions
  signal?: AbortSignal
  wraps?: WrapFn[]
}

export type TaskMap = Record<string, (this: unknown) => unknown>
