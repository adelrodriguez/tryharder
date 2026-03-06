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

export interface BuilderState {
  canSync: boolean
  canWrap: boolean
  isWrapped: boolean
}

export type DefaultBuilderState = {
  canSync: true
  canWrap: true
  isWrapped: false
}

export type SetBuilderState<
  State extends BuilderState,
  Key extends keyof BuilderState,
  Value extends BuilderState[Key],
> = Omit<State, Key> & { [K in Key]: Value }

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
