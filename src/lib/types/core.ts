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

export interface BaseTryCtx {
  signal?: AbortSignal
}

export interface TryCtxFeatures {
  retry: boolean
}

export type DefaultTryCtxFeatures = {
  retry: false
}

export type SetTryCtxFeature<
  Features extends TryCtxFeatures,
  Key extends keyof TryCtxFeatures,
> = Omit<Features, Key> & { [K in Key]: true }

export type TryCtxFor<Features extends TryCtxFeatures> = BaseTryCtx &
  (Features["retry"] extends true ? { retry: RetryInfo } : Record<never, never>)

export type TryCtx = TryCtxFor<{ retry: true }>

export type NonPromise<T> = T extends PromiseLike<unknown> ? never : T
