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

export type NonPromise<T> = T extends PromiseLike<unknown> ? never : T
