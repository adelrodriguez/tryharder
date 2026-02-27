import type { BuilderConfig } from "../types/builder"
import type { BaseTryCtx, NonPromise } from "../types/core"
import type { RetryPolicy } from "../types/retry"
import type { RunnerError } from "./base"
import { ConfigurationError, Panic, RetryExhaustedError, UnhandledException } from "../errors"
import { checkIsControlError, checkIsPromiseLike } from "../utils"
import { BaseExecution, RetryDirective } from "./base"

export type SyncRunTryFn<T, Ctx extends BaseTryCtx = BaseTryCtx> = (ctx: Ctx) => NonPromise<T>
export type SyncRunCatchFn<E> = (error: unknown) => NonPromise<E>

export interface SyncRunOptions<T, E, Ctx extends BaseTryCtx = BaseTryCtx> {
  try: SyncRunTryFn<T, Ctx>
  catch: SyncRunCatchFn<E>
}

export type SyncRunInput<T, E, Ctx extends BaseTryCtx = BaseTryCtx> =
  | SyncRunTryFn<T, Ctx>
  | SyncRunOptions<T, E, Ctx>

export type RunSyncTryFn<T> = () => NonPromise<T>
export type RunSyncCatchFn<E> = (error: unknown) => NonPromise<E>

export interface RunSyncOptions<T, E> {
  try: RunSyncTryFn<T>
  catch: RunSyncCatchFn<E>
}

export type RunSyncInput<T, E> = RunSyncTryFn<T> | RunSyncOptions<T, E>

function throwIfPromiseLike(value: unknown, message: string): void {
  if (checkIsPromiseLike(value)) {
    throw new ConfigurationError({ message })
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

class RunSyncExecution<T, E, Ctx extends BaseTryCtx> extends BaseExecution<T | E | RunnerError> {
  #catchFn: SyncRunCatchFn<E> | undefined
  #tryFn: SyncRunTryFn<T, Ctx>

  constructor(config: BuilderConfig, input: SyncRunInput<T, E, Ctx>) {
    super(config)

    this.#catchFn = typeof input === "function" ? undefined : input.catch
    this.#tryFn = typeof input === "function" ? input : input.try
  }

  override execute(): T | E | RunnerError {
    const result = super.execute()
    throwIfPromiseLike(result, "runSync() cannot handle Promise values. Use run() instead.")
    return result
  }

  protected override executeCore(): T | E | RunnerError {
    return this.#runAttemptLoop(1)
  }

  #finalizeFailure(error: unknown): E | RunnerError {
    if (checkIsControlError(error)) {
      return error
    }

    if (this.#catchFn) {
      let mapped: E

      try {
        mapped = this.#catchFn(error)
      } catch (catchError) {
        throw new Panic({ cause: catchError })
      }

      throwIfPromiseLike(mapped, "runSync() catch cannot return a Promise. Use run() instead.")

      const controlError = this.checkDidControlFail(error)

      if (controlError) {
        return controlError
      }

      return mapped
    }

    const controlError = this.checkDidControlFail(error)

    if (controlError) {
      return controlError
    }

    return new UnhandledException({ cause: error })
  }

  #resolveFailure(error: unknown): E | RunnerError | RetryDirective {
    if (checkIsControlError(error)) {
      return error
    }

    const controlError = this.checkDidControlFail(error)

    if (controlError) {
      return controlError
    }

    const retryDecision = this.buildRetryDecision(error)

    if (!retryDecision.shouldAttemptRetry) {
      if (retryDecision.isRetryExhausted) {
        return new RetryExhaustedError({ cause: error })
      }

      return this.#finalizeFailure(error)
    }

    return new RetryDirective(retryDecision)
  }

  #runAttemptLoop(attempt: number): T | E | RunnerError {
    let currentAttempt = attempt

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const controlBeforeAttempt = this.checkBeforeAttempt()

      if (controlBeforeAttempt) {
        return controlBeforeAttempt
      }

      this.ctx.retry.attempt = currentAttempt

      let result: NonPromise<T>

      try {
        result = this.#tryFn(this.ctx as unknown as Ctx)
      } catch (error) {
        const resolved = this.#resolveFailure(error)

        if (resolved instanceof RetryDirective) {
          if (resolved.decision.delay > 0) {
            throw new ConfigurationError({
              message: "This retry policy may run asynchronously. Use run() instead.",
            })
          }

          currentAttempt += 1
          continue
        }

        return resolved
      }

      throwIfPromiseLike(result, "The try function returned a Promise. Use run() instead.")

      return this.resolveSyncSuccess(result)
    }
  }
}

export function executeRunSync<T, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: SyncRunTryFn<T, Ctx>
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
    throw new ConfigurationError({
      message: "This retry policy may run asynchronously. Use run() instead.",
    })
  }

  using execution = new RunSyncExecution<T, E, Ctx>(config, input)
  return execution.execute()
}

export function runSync<T>(tryFn: RunSyncTryFn<T>): T | UnhandledException
export function runSync<T, E>(options: RunSyncOptions<T, E>): T | E
export function runSync<T, E>(input: RunSyncInput<T, E>): T | E | UnhandledException {
  const tryFn: RunSyncTryFn<T> = typeof input === "function" ? input : input.try
  const catchFn: RunSyncCatchFn<E> | undefined =
    typeof input === "function" ? undefined : input.catch

  try {
    const result = tryFn()
    throwIfPromiseLike(result, "runSync() cannot handle Promise values. Use run() instead.")
    return result
  } catch (error) {
    if (error instanceof Panic || error instanceof ConfigurationError) {
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
