import type { BaseTryCtx, NonPromise } from "./core"

export type SyncRunTryFn<T, Ctx extends BaseTryCtx = BaseTryCtx> = (ctx: Ctx) => NonPromise<T>
export type AsyncRunTryFn<T, Ctx extends BaseTryCtx = BaseTryCtx> = (ctx: Ctx) => Promise<T>
export type RunTryFn<T, Ctx extends BaseTryCtx = BaseTryCtx> =
  | SyncRunTryFn<T, Ctx>
  | AsyncRunTryFn<T, Ctx>

export type SyncRunCatchFn<E> = (error: unknown) => NonPromise<E>
export type AsyncRunCatchFn<E> = (error: unknown) => Promise<E>
export type RunCatchFn<E> = SyncRunCatchFn<E> | AsyncRunCatchFn<E>

export interface RunOptions<T, E, Ctx extends BaseTryCtx = BaseTryCtx> {
  try: SyncRunTryFn<T, Ctx>
  catch: SyncRunCatchFn<E>
}

export interface RunAsyncOptions<T, E, Ctx extends BaseTryCtx = BaseTryCtx> {
  try: RunTryFn<T, Ctx>
  catch: RunCatchFn<E>
}

export type SyncRunInput<T, E, Ctx extends BaseTryCtx = BaseTryCtx> =
  | SyncRunTryFn<T, Ctx>
  | RunOptions<T, E, Ctx>
export type AsyncRunInput<T, E, Ctx extends BaseTryCtx = BaseTryCtx> =
  | RunTryFn<T, Ctx>
  | RunAsyncOptions<T, E, Ctx>
