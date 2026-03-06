import type { BaseTryCtx, NonPromise } from "./core"

export type RunTryFn<T, Ctx extends BaseTryCtx = BaseTryCtx> = (
  ctx: Ctx
) => NonPromise<T> | Promise<T>

export type RunCatchFn<E> = (error: unknown) => NonPromise<E> | Promise<E>

export interface RunAsyncOptions<T, E, Ctx extends BaseTryCtx = BaseTryCtx> {
  try: RunTryFn<T, Ctx>
  catch: RunCatchFn<E>
}

export type AsyncRunInput<T, E, Ctx extends BaseTryCtx = BaseTryCtx> =
  | RunTryFn<T, Ctx>
  | RunAsyncOptions<T, E, Ctx>
