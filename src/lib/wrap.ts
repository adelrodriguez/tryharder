import type { WrapFn } from "./types/builder"
import type { TryCtx } from "./types/core"
import type { RunTryFn } from "./types/run"

export function executeWithWraps<R>(
  wraps: readonly WrapFn[] | undefined,
  ctx: TryCtx,
  terminal: (ctx: TryCtx) => R
): R {
  if (!wraps || wraps.length === 0) {
    return terminal(ctx)
  }

  let next: RunTryFn<unknown, TryCtx> = (nextCtx) => terminal(nextCtx)

  for (const wrap of wraps.toReversed()) {
    const previous: RunTryFn<unknown, TryCtx> = next
    next = (wrapCtx) => wrap(wrapCtx, previous)
  }

  return next(ctx) as R
}
