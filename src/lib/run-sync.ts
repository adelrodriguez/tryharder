import type { BuilderConfig } from "./types/builder"
import type { BaseTryCtx } from "./types/core"
import type { RetryPolicy } from "./types/retry"
import type {
  RunSyncCatchFn,
  RunSyncInput,
  RunSyncTryFn,
  SyncRunInput,
  SyncRunTryFn as CtxSyncRunTryFn,
} from "./types/run"
import { Panic, UnhandledException } from "./errors"
import { RunExecution, type RunnerError } from "./run"
import { checkIsPromiseLike } from "./utils"

function throwIfPromiseLike(value: unknown, message: string): void {
  if (checkIsPromiseLike(value)) {
    throw new Panic({ message })
  }
}

function checkIsSyncSafeRetryPolicy(retryPolicy: RetryPolicy | undefined): boolean {
  if (!retryPolicy) {
    return true
  }

  if (retryPolicy.backoff !== "constant") {
    return false
  }

  if (retryPolicy.jitter) {
    return false
  }

  return (retryPolicy.delayMs ?? 0) <= 0
}

export function executeRunSync<T, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: CtxSyncRunTryFn<T, Ctx>
): T | UnhandledException | RunnerError
export function executeRunSync<T, E, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: SyncRunInput<T, E, Ctx>
): T | E | RunnerError
export function executeRunSync<T, E, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: SyncRunInput<T, E, Ctx>
): T | E | RunnerError {
  if (!checkIsSyncSafeRetryPolicy(config.retry)) {
    throw new Panic({
      message: "This retry policy may run asynchronously. Use run() instead.",
    })
  }

  using execution = new RunExecution<T, E, Ctx>(config, input)
  const result = execution.executeSync()

  if (checkIsPromiseLike(result)) {
    throw new Panic({
      message: "The try function returned a Promise. Use run() instead.",
    })
  }

  return result
}

export function runSync<T>(tryFn: RunSyncTryFn<T>): T | UnhandledException
export function runSync<T, E>(options: { try: RunSyncTryFn<T>; catch: RunSyncCatchFn<E> }): T | E
export function runSync<T, E>(input: RunSyncInput<T, E>): T | E | UnhandledException {
  const tryFn: RunSyncTryFn<T> = typeof input === "function" ? input : input.try
  const catchFn: RunSyncCatchFn<E> | undefined =
    typeof input === "function" ? undefined : input.catch

  try {
    const result = tryFn()
    throwIfPromiseLike(result, "runSync() cannot handle Promise values. Use run() instead.")
    return result
  } catch (error) {
    if (error instanceof Panic) {
      throw error
    }

    if (!catchFn) {
      return new UnhandledException({ cause: error })
    }

    try {
      const mapped = catchFn(error)
      throwIfPromiseLike(mapped, "runSync() catch cannot return a Promise. Use run() instead.")
      return mapped
    } catch (catchError) {
      throw new Panic({ cause: catchError })
    }
  }
}
