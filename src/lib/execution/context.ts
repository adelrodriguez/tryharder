interface RetryInfo {
  attempt: number
  limit: number
}

export interface BaseTryCtx {
  signal?: AbortSignal
}

export type TryCtxFor<HasRetry extends boolean> = HasRetry extends true
  ? BaseTryCtx & { retry: RetryInfo }
  : BaseTryCtx

export type TryCtx = TryCtxFor<true>
