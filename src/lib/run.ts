import type { BuilderConfig } from "./types/builder"
import type { BaseTryCtx, TryCtx } from "./types/core"
import type { AsyncRunInput, AsyncRunTryFn, RunCatchFn, RunTryFn, SyncRunTryFn } from "./types/run"
import {
  CancellationError,
  Panic,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "./errors"
import { calculateRetryDelay, checkIsRetryExhausted, checkShouldAttemptRetry } from "./retry"
import { SignalController } from "./signal"
import { TimeoutController } from "./timeout"
import { checkIsControlError, checkIsPromiseLike, sleep } from "./utils"

export type RunnerError =
  | CancellationError
  | Panic
  | RetryExhaustedError
  | TimeoutError
  | UnhandledException

type RetryDecision = {
  delay: number
  isRetryExhausted: boolean
  shouldAttemptRetry: boolean
}

const RETRY_RESULT = Symbol("RETRY_RESULT")

type RetryResult = {
  [RETRY_RESULT]: true
  retry: RetryDecision
}

function checkIsRetryResult(value: unknown): value is RetryResult {
  return typeof value === "object" && value !== null && RETRY_RESULT in value
}

const CONTINUE_SYNC = Symbol("CONTINUE_SYNC")

type SyncRetryContinuation = {
  [CONTINUE_SYNC]: true
  nextAttempt: number
}

function checkIsSyncRetryContinuation(value: unknown): value is SyncRetryContinuation {
  return typeof value === "object" && value !== null && CONTINUE_SYNC in value
}

function extractControlResult(value: unknown): CancellationError | TimeoutError | undefined {
  if (value instanceof TimeoutError || value instanceof CancellationError) {
    return value
  }

  return undefined
}

/** Encapsulates the shared mutable state and logic for a single run execution. */
export class RunExecution<T, E, Ctx extends BaseTryCtx> {
  #config: BuilderConfig
  #ctx: TryCtx
  #signal: SignalController
  #timeout: TimeoutController
  #catchFn: RunCatchFn<E> | undefined
  #tryFn: SyncRunTryFn<T, Ctx> | AsyncRunTryFn<T, Ctx>

  constructor(config: BuilderConfig, input: AsyncRunInput<T, E, Ctx>) {
    this.#config = config
    this.#timeout = new TimeoutController(config.timeout)
    this.#signal = new SignalController(
      [...(config.signals ?? []), this.#timeout.signal].filter(
        (value): value is AbortSignal => value !== undefined
      )
    )
    this.#ctx = RunExecution.#createContext(config, this.#signal.signal)

    this.#catchFn = typeof input === "function" ? undefined : input.catch
    this.#tryFn = typeof input === "function" ? input : input.try
  }

  execute(): T | E | RunnerError | Promise<T | E | RunnerError> {
    return this.#runWithWraps()
  }

  static #createContext(config: BuilderConfig, signal?: AbortSignal): TryCtx {
    return {
      retry: {
        attempt: 1,
        limit: config.retry?.limit ?? 1,
      },
      signal,
    }
  }

  [Symbol.dispose](): void {
    using disposer = new DisposableStack()
    disposer.use(this.#timeout)
    disposer.use(this.#signal)
  }

  #runWithWraps(): T | E | RunnerError | Promise<T | E | RunnerError> {
    const wraps = this.#config.wraps

    if (!wraps || wraps.length === 0) {
      return this.#runAttemptLoopSync(1)
    }

    let next: RunTryFn<unknown, TryCtx> = (_ctx) => this.#runAttemptLoopSync(1)

    for (const wrap of wraps.toReversed()) {
      const previous: RunTryFn<unknown, TryCtx> = next

      next = (ctx) => wrap(ctx, previous)
    }

    return next(this.#ctx) as T | E | RunnerError | Promise<T | E | RunnerError>
  }

  #checkDidControlFail(cause?: unknown): CancellationError | TimeoutError | undefined {
    return this.#signal.checkDidCancel(cause) ?? this.#timeout.checkDidTimeout(cause)
  }

  #checkBeforeAttempt(): CancellationError | TimeoutError | undefined {
    return this.#checkDidControlFail()
  }

  #resolveSyncSuccess(result: T): T | CancellationError | TimeoutError {
    return this.#checkDidControlFail() ?? result
  }

  static #resolveRacedResult<V>(
    value: V | CancellationError | TimeoutError
  ): V | CancellationError | TimeoutError {
    const controlResult = extractControlResult(value)

    if (controlResult) {
      return controlResult
    }

    return value
  }

  async #resolveAsyncTryResult(
    promise: PromiseLike<T>
  ): Promise<T | CancellationError | TimeoutError> {
    const raced = await this.#race(Promise.resolve(promise))
    return RunExecution.#resolveRacedResult(raced)
  }

  async #waitForRetryDelay(delay: number): Promise<CancellationError | TimeoutError | undefined> {
    if (delay <= 0) {
      return undefined
    }

    const sleepResult = await this.#race(sleep(delay))
    const sleepControlResult = extractControlResult(sleepResult)

    if (sleepControlResult) {
      return sleepControlResult
    }

    return undefined
  }

  async #race<V>(
    promise: PromiseLike<V>,
    cause?: unknown
  ): Promise<V | CancellationError | TimeoutError> {
    const raced = await this.#timeout.race(this.#signal.race(promise, cause), cause)

    if (raced instanceof TimeoutError) {
      const cancelled = this.#signal.checkDidCancel(cause)

      if (cancelled) {
        return cancelled
      }
    }

    return raced
  }

  /** Route a terminal error to the catch handler or wrap in UnhandledException. */
  #finalizeFailure(error: unknown): E | RunnerError | Promise<E | RunnerError> {
    if (checkIsControlError(error)) {
      return error
    }

    if (this.#catchFn) {
      let mapped: E | Promise<E>

      try {
        mapped = this.#catchFn(error)
      } catch (catchError) {
        throw new Panic({ cause: catchError })
      }

      if (checkIsPromiseLike(mapped)) {
        const mappedWithPanic = (async (): Promise<E> => {
          try {
            return await mapped
          } catch (catchError) {
            throw new Panic({ cause: catchError })
          }
        })()

        return this.#race(mappedWithPanic, error)
      }

      const controlError = this.#checkDidControlFail(error)

      if (controlError) {
        return controlError
      }

      return mapped
    }

    const controlError = this.#checkDidControlFail(error)

    if (controlError) {
      return controlError
    }

    return new UnhandledException({ cause: error })
  }

  #buildRetryDecision(error: unknown): RetryDecision {
    const shouldAttemptRetry = checkShouldAttemptRetry(error, this.#ctx, this.#config)

    return {
      delay: shouldAttemptRetry ? calculateRetryDelay(this.#ctx.retry.attempt, this.#config) : 0,
      isRetryExhausted: checkIsRetryExhausted(this.#ctx.retry.attempt, this.#config),
      shouldAttemptRetry,
    }
  }

  /** Resolve an attempt error into either a terminal result or a retry decision. */
  #resolveFailure(error: unknown): E | RunnerError | Promise<E | RunnerError> | RetryResult {
    if (checkIsControlError(error)) {
      return error
    }

    const controlError = this.#checkDidControlFail(error)

    if (controlError) {
      return controlError
    }

    const retryDecision = this.#buildRetryDecision(error)

    if (!retryDecision.shouldAttemptRetry) {
      if (retryDecision.isRetryExhausted) {
        return new RetryExhaustedError({ cause: error })
      }

      return this.#finalizeFailure(error)
    }

    return { [RETRY_RESULT]: true, retry: retryDecision }
  }

  #handleSyncFailure(
    error: unknown
  ): T | E | RunnerError | Promise<T | E | RunnerError> | SyncRetryContinuation {
    const resolved = this.#resolveFailure(error)

    if (!checkIsRetryResult(resolved)) {
      return resolved
    }

    if (resolved.retry.delay <= 0) {
      return { [CONTINUE_SYNC]: true, nextAttempt: this.#ctx.retry.attempt + 1 }
    }

    return this.#runAttemptLoopAsync(resolved.retry)
  }

  async #handleAsyncFailure(error: unknown): Promise<T | E | RunnerError> {
    const resolved = this.#resolveFailure(error)

    if (!checkIsRetryResult(resolved)) {
      return resolved
    }

    return this.#runAttemptLoopAsync(resolved.retry)
  }

  /** Async retry loop. Once we enter async we stay async for all subsequent attempts. */
  async #runAttemptLoopAsync(decision: RetryDecision): Promise<T | E | RunnerError> {
    let currentDecision = decision
    let currentAttempt = this.#ctx.retry.attempt + 1

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const controlBeforeAttempt = this.#checkBeforeAttempt()

      if (controlBeforeAttempt) {
        return controlBeforeAttempt
      }

      // oxlint-disable-next-line no-await-in-loop
      const delayControlResult = await this.#waitForRetryDelay(currentDecision.delay)

      if (delayControlResult) {
        return delayControlResult
      }

      this.#ctx.retry.attempt = currentAttempt

      try {
        const result = this.#tryFn(this.#ctx as unknown as Ctx)

        if (checkIsPromiseLike(result)) {
          // oxlint-disable-next-line no-await-in-loop
          return await this.#resolveAsyncTryResult(result)
        }

        return this.#resolveSyncSuccess(result)
      } catch (attemptError) {
        const resolved = this.#resolveFailure(attemptError)

        if (!checkIsRetryResult(resolved)) {
          return resolved
        }

        currentDecision = resolved.retry
        currentAttempt += 1
      }
    }
  }

  /** Attempt loop. Starts synchronous and upgrades to async if the try fn returns a promise. */
  #runAttemptLoopSync(attempt: number): T | E | RunnerError | Promise<T | E | RunnerError> {
    let currentAttempt = attempt

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const controlBeforeAttempt = this.#checkBeforeAttempt()

      if (controlBeforeAttempt) {
        return controlBeforeAttempt
      }

      this.#ctx.retry.attempt = currentAttempt

      try {
        const result = this.#tryFn(this.#ctx as unknown as Ctx)

        if (checkIsPromiseLike(result)) {
          return this.#resolveAsyncTryResult(result).catch((error: unknown) =>
            this.#handleAsyncFailure(error)
          )
        }

        return this.#resolveSyncSuccess(result)
      } catch (error) {
        const handled = this.#handleSyncFailure(error)

        if (checkIsSyncRetryContinuation(handled)) {
          currentAttempt = handled.nextAttempt
          continue
        }

        return handled
      }
    }
  }
}

export function executeRun<T, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: SyncRunTryFn<T, Ctx> | AsyncRunTryFn<T, Ctx>
): Promise<T | UnhandledException>
export function executeRun<T, E, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: AsyncRunInput<T, E, Ctx>
): Promise<T | E>
export function executeRun<T, E, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: AsyncRunInput<T, E, Ctx>
): Promise<T | E | RunnerError>
export async function executeRun<T, E, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: AsyncRunInput<T, E, Ctx>
): Promise<T | E | RunnerError> {
  using execution = new RunExecution<T, E, Ctx>(config, input)
  return await execution.execute()
}
