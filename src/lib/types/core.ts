interface RetryInfo {
  attempt: number
  limit: number
}

export interface BaseTryCtx {
  signal?: AbortSignal
}

export type TryCtxFor<HasRetry extends boolean> = BaseTryCtx &
  (HasRetry extends true ? { retry: RetryInfo } : Record<never, never>)

export type TryCtx = TryCtxFor<true>

export type NonPromise<T> = T extends PromiseLike<unknown> ? never : T
