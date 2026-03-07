import type { BuilderConfig } from "../types/builder"
import type { BaseTryCtx, NonPromise } from "../types/core"
import type { RunnerError } from "./base"
import { Panic, RetryExhaustedError, UnhandledException, type PanicCode } from "../errors"
import { checkIsControlError, checkIsPromiseLike, invariant } from "../utils"
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

function assertNotPromiseLike(value: unknown, code: PanicCode, message?: string): void {
  invariant(
    !checkIsPromiseLike(value),
    new Panic(code, message === undefined ? undefined : { message })
  )
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
    assertNotPromiseLike(result, "RUN_SYNC_WRAPPED_RESULT_PROMISE")
    return result
  }

  protected override executeCore(): T | E | RunnerError {
    return this.#runAttemptLoop(1)
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

    if (retryDecision.shouldAttemptRetry) {
      return new RetryDirective(retryDecision)
    }

    if (retryDecision.isRetryExhausted) {
      return new RetryExhaustedError(undefined, { cause: error })
    }

    if (!this.#catchFn) {
      // Even without a catch handler, cancellation/timeout may have won since
      // the original failure was first observed.
      const finalizeControlError = this.checkDidControlFail(error)

      if (finalizeControlError) {
        return finalizeControlError
      }

      return new UnhandledException(undefined, { cause: error })
    }

    let mapped: E

    try {
      mapped = this.#catchFn(error)
    } catch (catchError) {
      throw new Panic("RUN_SYNC_CATCH_HANDLER_THROW", { cause: catchError })
    }

    assertNotPromiseLike(mapped, "RUN_SYNC_CATCH_PROMISE")

    // Control state can change while the catch handler runs, so check again
    // before returning a mapped sync value.
    const catchControlError = this.checkDidControlFail(error)

    if (catchControlError) {
      return catchControlError
    }

    return mapped
  }

  #runAttemptLoop(attempt: number): T | E | RunnerError {
    let currentAttempt = attempt

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const controlBeforeAttempt = this.checkDidControlFail()

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
            throw new Panic("RUN_SYNC_ASYNC_RETRY_POLICY")
          }

          currentAttempt += 1
          continue
        }

        return resolved
      }

      assertNotPromiseLike(result, "RUN_SYNC_TRY_PROMISE")

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
  // Builder typing blocks async-only retry policies, but direct executor usage and
  // unsafe casts still need a runtime guard here.
  const isSyncSafeRetryPolicy =
    config.retry === undefined ||
    (config.retry.backoff === "constant" &&
      !config.retry.jitter &&
      (config.retry.delayMs ?? 0) <= 0)

  invariant(isSyncSafeRetryPolicy, new Panic("RUN_SYNC_ASYNC_RETRY_POLICY"))

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
    assertNotPromiseLike(result, "RUN_SYNC_TRY_PROMISE")
    return result
  } catch (error) {
    if (error instanceof Panic) {
      throw error
    }

    if (!catchFn) {
      return new UnhandledException(undefined, { cause: error })
    }

    try {
      const mapped = catchFn(error)
      assertNotPromiseLike(mapped, "RUN_SYNC_CATCH_PROMISE")
      return mapped
    } catch (catchError) {
      if (catchError instanceof Panic && catchError.code === "RUN_SYNC_CATCH_PROMISE") {
        throw catchError
      }

      throw new Panic("RUN_SYNC_CATCH_HANDLER_THROW", { cause: catchError })
    }
  }
}
