import type { NonPromise, TryCtx } from "./core"

export type SyncRunTryFn<T> = (ctx: TryCtx) => NonPromise<T>
export type AsyncRunTryFn<T> = (ctx: TryCtx) => Promise<T>
export type RunTryFn<T> = SyncRunTryFn<T> | AsyncRunTryFn<T>

export type SyncRunCatchFn<E> = (error: unknown) => NonPromise<E>
export type AsyncRunCatchFn<E> = (error: unknown) => Promise<E>
export type RunCatchFn<E> = SyncRunCatchFn<E> | AsyncRunCatchFn<E>

export interface RunWithCatchOptions<T, E> {
  try: RunTryFn<T>
  catch: RunCatchFn<E>
}

export type RunInput<T, E> = RunTryFn<T> | RunWithCatchOptions<T, E>
