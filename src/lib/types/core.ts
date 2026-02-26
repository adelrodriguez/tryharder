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

export interface TryCtxProperties {
  retry: boolean
}

export type DefaultTryCtxProperties = {
  retry: false
}

export type SetTryCtxFeature<
  Features extends TryCtxProperties,
  Key extends keyof TryCtxProperties,
> = Omit<Features, Key> & { [K in Key]: true }

export type TryCtxFor<Features extends TryCtxProperties> = BaseTryCtx &
  (Features["retry"] extends true ? { retry: RetryInfo } : Record<never, never>)

export type TryCtx = TryCtxFor<{ retry: true }>

export type NonPromise<T> = T extends PromiseLike<unknown> ? never : T
