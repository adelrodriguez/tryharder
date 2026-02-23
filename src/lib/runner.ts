import type { BuilderConfig } from "./types/builder"
import type { BaseTryCtx, TryCtx } from "./types/core"
import type { RetryPolicy } from "./types/retry"
import type {
  AsyncRunInput,
  AsyncRunTryFn,
  RunCatchFn,
  RunTryFn,
  SyncRunInput,
  SyncRunTryFn,
} from "./types/run"
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

type RunnerError =
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

/** Encapsulates the shared mutable state and logic for a single run execution. */
class RunExecution<T, E, Ctx extends BaseTryCtx> {
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
    return this.#executeWrappedRun()
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

  #executeWrappedRun(): T | E | RunnerError | Promise<T | E | RunnerError> {
    const wraps = this.#config.wraps

    if (!wraps || wraps.length === 0) {
      return this.#executeAttemptSync(1)
    }

    let next: RunTryFn<unknown, TryCtx> = (_ctx) => this.#executeAttemptSync(1)

    for (const wrap of wraps.toReversed()) {
      const previous: RunTryFn<unknown, TryCtx> = next

      next = (ctx) => wrap(ctx, previous)
    }

    return next(this.#ctx) as T | E | RunnerError | Promise<T | E | RunnerError>
  }

  #checkDidControlFail(cause?: unknown): CancellationError | TimeoutError | undefined {
    return this.#signal.checkDidCancel(cause) ?? this.#timeout.checkDidTimeout(cause)
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
  #finalizeError(error: unknown): E | RunnerError | Promise<E | RunnerError> {
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

  #evaluateRetryDecision(error: unknown): RetryDecision {
    const shouldAttemptRetry = checkShouldAttemptRetry(error, this.#ctx, this.#config)

    return {
      delay: shouldAttemptRetry ? calculateRetryDelay(this.#ctx.retry.attempt, this.#config) : 0,
      isRetryExhausted: checkIsRetryExhausted(this.#ctx.retry.attempt, this.#config),
      shouldAttemptRetry,
    }
  }

  /** Resolve an attempt error into either a terminal result or a retry decision. */
  #resolveAttemptError(
    error: unknown,
    decision?: RetryDecision
  ): E | RunnerError | Promise<E | RunnerError> | RetryResult {
    if (checkIsControlError(error)) {
      return error
    }

    const controlError = this.#checkDidControlFail(error)

    if (controlError) {
      return controlError
    }

    const retryDecision = decision ?? this.#evaluateRetryDecision(error)

    if (!retryDecision.shouldAttemptRetry) {
      if (retryDecision.isRetryExhausted) {
        return new RetryExhaustedError({ cause: error })
      }

      return this.#finalizeError(error)
    }

    return { [RETRY_RESULT]: true, retry: retryDecision }
  }

  #handleAttemptErrorSync(
    error: unknown
  ): T | E | RunnerError | Promise<T | E | RunnerError> | SyncRetryContinuation {
    const resolved = this.#resolveAttemptError(error)

    if (!checkIsRetryResult(resolved)) {
      return resolved
    }

    if (resolved.retry.delay <= 0) {
      return { [CONTINUE_SYNC]: true, nextAttempt: this.#ctx.retry.attempt + 1 }
    }

    return this.#executeAttemptAsync(resolved.retry)
  }

  async #handleAttemptErrorAsync(error: unknown): Promise<T | E | RunnerError> {
    const resolved = this.#resolveAttemptError(error)

    if (!checkIsRetryResult(resolved)) {
      return resolved
    }

    return this.#executeAttemptAsync(resolved.retry)
  }

  /** Async retry loop. Once we enter async we stay async for all subsequent attempts. */
  async #executeAttemptAsync(decision: RetryDecision): Promise<T | E | RunnerError> {
    let currentDecision = decision
    let currentAttempt = this.#ctx.retry.attempt + 1

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const controlBeforeAttempt = this.#checkDidControlFail()

      if (controlBeforeAttempt) {
        return controlBeforeAttempt
      }

      if (currentDecision.delay > 0) {
        // oxlint-disable-next-line no-await-in-loop
        const sleepResult = await this.#race(sleep(currentDecision.delay))
        const sleepControlResult = extractControlResult(sleepResult)

        if (sleepControlResult) {
          return sleepControlResult
        }
      }

      this.#ctx.retry.attempt = currentAttempt

      try {
        const result = this.#tryFn(this.#ctx as unknown as Ctx)

        if (checkIsPromiseLike(result)) {
          // oxlint-disable-next-line no-await-in-loop
          const asyncResult = await this.#race(Promise.resolve(result))
          const asyncControlResult = extractControlResult(asyncResult)

          if (asyncControlResult) {
            return asyncControlResult
          }

          return asyncResult as T
        }

        const controlAfterSync = this.#checkDidControlFail()

        if (controlAfterSync) {
          return controlAfterSync
        }

        return result
      } catch (attemptError) {
        const resolved = this.#resolveAttemptError(attemptError)

        if (!checkIsRetryResult(resolved)) {
          return resolved
        }

        currentDecision = resolved.retry
        currentAttempt += 1
      }
    }
  }

  /** Attempt loop. Starts synchronous and upgrades to async if the try fn returns a promise. */
  #executeAttemptSync(attempt: number): T | E | RunnerError | Promise<T | E | RunnerError> {
    let currentAttempt = attempt

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const controlBeforeAttempt = this.#checkDidControlFail()

      if (controlBeforeAttempt) {
        return controlBeforeAttempt
      }

      this.#ctx.retry.attempt = currentAttempt

      try {
        const result = this.#tryFn(this.#ctx as unknown as Ctx)

        if (checkIsPromiseLike(result)) {
          return this.#race(Promise.resolve(result))
            .then((resolved) => {
              const controlResult = extractControlResult(resolved)

              if (controlResult) {
                return controlResult
              }

              return resolved as T
            })
            .catch((error: unknown) => this.#handleAttemptErrorAsync(error))
        }

        const controlAfterSync = this.#checkDidControlFail()

        if (controlAfterSync) {
          return controlAfterSync
        }

        return result
      } catch (error) {
        const handled = this.#handleAttemptErrorSync(error)

        if (checkIsSyncRetryContinuation(handled)) {
          currentAttempt = handled.nextAttempt
          continue
        }

        return handled
      }
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
    throw new Panic({
      message: "This retry policy may run asynchronously. Use runAsync() instead of run().",
    })
  }

  using execution = new RunExecution<T, E, Ctx>(config, input)
  const result = execution.execute()

  if (checkIsPromiseLike(result)) {
    throw new Panic({
      message: "The try function returned a Promise. Use runAsync() instead of run().",
    })
  }

  return result
}

export function executeRunAsync<T, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: SyncRunTryFn<T, Ctx> | AsyncRunTryFn<T, Ctx>
): Promise<T | UnhandledException | RunnerError>
export function executeRunAsync<T, E, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: AsyncRunInput<T, E, Ctx>
): Promise<T | E | RunnerError>
export async function executeRunAsync<T, E, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: AsyncRunInput<T, E, Ctx>
): Promise<T | E | RunnerError> {
  using execution = new RunExecution<T, E, Ctx>(config, input)
  return await execution.execute()
}
