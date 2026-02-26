import type { BuilderConfig } from "./types/builder"
import type { BaseTryCtx } from "./types/core"
import type { RetryPolicy } from "./types/retry"
import type {
  AsyncRunInput,
  AsyncRunTryFn,
  RunCatchFn,
  SyncRunInput,
  SyncRunTryFn,
} from "./types/run"
import { createContext } from "./context"
import {
  CancellationError,
  Panic,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "./errors"
import { calculateRetryDelay, checkIsRetryExhausted, checkShouldAttemptRetry } from "./retry"
import { createSignalController } from "./signal"
import { createTimeoutController } from "./timeout"
import { checkIsControlError, checkIsPromiseLike, sleep } from "./utils"

/**
 * Union of all error types the runner can produce internally. Used to type
 * internal helper return values -- the public API narrows these via the
 * builder's overloads.
 */
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

/**
 * Run the user-provided catch handler, wrapping any failure in a Panic.
 *
 * If the catch handler itself throws (or returns a rejected promise), the
 * error is unrecoverable so we escalate it as a Panic.
 */
function executeCatch<E>(catchFn: RunCatchFn<E>, error: unknown): E | Promise<E> {
  try {
    const mapped = catchFn(error)

    // If catch returned a promise, attach a rejection handler that wraps
    // any failure in a Panic so it doesn't surface as an unhandled rejection.
    if (checkIsPromiseLike(mapped)) {
      return Promise.resolve(mapped).catch((catchError: unknown) => {
        throw new Panic({ cause: catchError })
      })
    }

    return mapped
  } catch (catchError) {
    throw new Panic({ cause: catchError })
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

function throwSyncRetryPolicyError(): never {
  throw new Error("This retry policy may run asynchronously. Use runAsync() instead of run().")
}

function throwSyncPromiseError(): never {
  throw new Error("The try function returned a Promise. Use runAsync() instead of run().")
}

// -- Overloads: narrow the return type based on whether the input is sync/async
// and whether a catch handler is provided. --

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
    throwSyncRetryPolicyError()
  }

  const result = executeRunCore(config, input)

  if (checkIsPromiseLike(result)) {
    throwSyncPromiseError()
  }

  return result
}

export function executeRunAsync<T, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: SyncRunTryFn<T, Ctx> | AsyncRunTryFn<T, Ctx>
): Promise<T | UnhandledException>
export function executeRunAsync<T, E, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: AsyncRunInput<T, E, Ctx>
): Promise<T | E>
export function executeRunAsync<T, E, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: AsyncRunInput<T, E, Ctx>
): Promise<T | E | RunnerError> {
  return Promise.resolve().then(() => executeRunCore(config, input))
}

/**
 * Core execution engine. Runs the try function with optional retry, catch, and
 * timeout support. Stays synchronous when possible and only becomes async when
 * the try function returns a promise or a retry delay is needed.
 */
function executeRunCore<T, E, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: AsyncRunInput<T, E, Ctx>
) {
  const timeout = createTimeoutController(config.timeout)
  const signal = createSignalController(
    [config.signal, timeout.signal].filter((value): value is AbortSignal => value !== undefined)
  )
  const ctx = createContext(config, signal.signal)

  // Normalize input: accept either a bare function or a { try, catch } object.
  const catchFn = typeof input === "function" ? undefined : input.catch
  const tryFn = typeof input === "function" ? input : input.try

  const checkDidControlFail = (cause?: unknown): CancellationError | TimeoutError | undefined =>
    signal.checkDidCancel(cause) ?? timeout.checkDidTimeout(cause)

  const raceWithControl = async <V>(
    promise: PromiseLike<V>,
    cause?: unknown
  ): Promise<V | CancellationError | TimeoutError> => {
    const raced = await timeout.raceWithTimeout(signal.raceWithSignal(promise, cause), cause)

    if (raced instanceof TimeoutError) {
      const cancelled = signal.checkDidCancel(cause)

      if (cancelled) {
        return cancelled
      }
    }

    return raced
  }

  /**
   * Terminal error handler. Called when no more retries will happen.
   * Routes the error to the catch handler, or wraps it in UnhandledException
   * if no catch was provided. Control errors (Panic, Timeout, Cancellation)
   * always pass through unchanged.
   */
  const finalizeError = (error: unknown): E | RunnerError | Promise<E | RunnerError> => {
    if (checkIsControlError(error)) {
      return error
    }

    if (catchFn) {
      const mapped = executeCatch(catchFn, error)

      if (checkIsPromiseLike(mapped)) {
        return raceWithControl(mapped, error)
      }

      const timeoutError = checkDidControlFail(error)

      if (timeoutError) {
        return timeoutError
      }

      return mapped
    }

    const timeoutError = checkDidControlFail(error)

    if (timeoutError) {
      return timeoutError
    }

    return new UnhandledException({ cause: error })
  }

  const evaluateRetryDecision = (error: unknown): RetryDecision => {
    const shouldAttemptRetry = checkShouldAttemptRetry(error, ctx, config)

    return {
      delay: shouldAttemptRetry ? calculateRetryDelay(ctx.retry.attempt, config) : 0,
      isRetryExhausted: checkIsRetryExhausted(ctx.retry.attempt, config),
      shouldAttemptRetry,
    }
  }

  /**
   * Resolve an attempt error into either a terminal result or a retry decision.
   *
   * Control errors pass through unchanged, exhausted retries produce a
   * RetryExhaustedError (skipping catch), and non-retryable errors are
   * finalized through the catch handler or wrapped in UnhandledException.
   *
   * Returns the retry decision when the error should be retried.
   */
  const resolveAttemptError = (
    error: unknown,
    decision?: RetryDecision
  ): E | RunnerError | Promise<E | RunnerError> | RetryResult => {
    if (checkIsControlError(error)) {
      return error
    }

    const timeoutError = checkDidControlFail(error)

    if (timeoutError) {
      return timeoutError
    }

    const retryDecision = decision ?? evaluateRetryDecision(error)

    if (!retryDecision.shouldAttemptRetry) {
      if (retryDecision.isRetryExhausted) {
        return new RetryExhaustedError({ cause: error })
      }

      return finalizeError(error)
    }

    return { [RETRY_RESULT]: true, retry: retryDecision }
  }

  /**
   * Handle a failed attempt in the synchronous path.
   *
   * Decides whether to retry, finalize the error, or switch to the async path
   * (when a non-zero delay is required between retries).
   */
  const handleAttemptErrorSync = (
    error: unknown
  ): T | E | RunnerError | Promise<T | E | RunnerError> | SyncRetryContinuation => {
    const resolved = resolveAttemptError(error)

    if (!checkIsRetryResult(resolved)) {
      return resolved
    }

    // No delay needed -- stay on the synchronous path for the next attempt.
    if (resolved.retry.delay <= 0) {
      return { [CONTINUE_SYNC]: true, nextAttempt: ctx.retry.attempt + 1 }
    }

    // A delay is required, so we must switch to the async retry loop.
    return executeAsyncRetry(resolved.retry)
  }

  /**
   * Handle a failed attempt in the asynchronous path.
   */
  const handleAttemptErrorAsync = async (
    error: unknown,
    decision?: RetryDecision
  ): Promise<T | E | RunnerError> => {
    const resolved = resolveAttemptError(error, decision)

    if (!checkIsRetryResult(resolved)) {
      return resolved
    }

    return executeAsyncRetry(resolved.retry)
  }

  /**
   * Execute the async retry loop. Awaits the backoff delay, then recursively
   * retries. Once we enter the async path we stay async for all subsequent
   * attempts.
   */
  const executeAsyncRetry = async (decision: RetryDecision): Promise<T | E | RunnerError> => {
    const timeoutBeforeDelay = checkDidControlFail()

    if (timeoutBeforeDelay) {
      return timeoutBeforeDelay
    }

    if (decision.delay > 0) {
      const sleepResult = await raceWithControl(sleep(decision.delay))

      if (sleepResult instanceof TimeoutError) {
        return sleepResult
      }
    }

    ctx.retry.attempt += 1

    try {
      // Runtime context always includes retry metadata; when a call site is
      // typed with a narrower BaseTryCtx, passing this wider value is safe.
      const result = tryFn(ctx as unknown as Ctx)

      if (checkIsPromiseLike(result)) {
        const asyncResult = await raceWithControl(Promise.resolve(result))

        if (asyncResult instanceof TimeoutError) {
          return asyncResult
        }

        if (asyncResult instanceof CancellationError) {
          return asyncResult
        }

        return asyncResult as T
      }

      const timeoutAfterSyncResult = checkDidControlFail()

      if (timeoutAfterSyncResult) {
        return timeoutAfterSyncResult
      }

      return result
    } catch (attemptError) {
      return handleAttemptErrorAsync(attemptError)
    }
  }

  /**
   * Execute a single attempt, starting on the synchronous path.
   *
   * If the try function returns a promise, we attach a rejection handler and
   * switch to the async error path. Otherwise errors are handled synchronously.
   */
  const executeAttemptSync = (
    attempt: number
  ): T | E | RunnerError | Promise<T | E | RunnerError> => {
    let currentAttempt = attempt

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const timeoutBeforeAttempt = checkDidControlFail()

      if (timeoutBeforeAttempt) {
        return timeoutBeforeAttempt
      }

      ctx.retry.attempt = currentAttempt

      try {
        // Runtime context always includes retry metadata; when a call site is
        // typed with a narrower BaseTryCtx, passing this wider value is safe.
        const result = tryFn(ctx as unknown as Ctx)

        // The try function returned a promise -- handle rejections asynchronously.
        if (checkIsPromiseLike(result)) {
          return (async (): Promise<T | E | RunnerError> => {
            try {
              const resolved = await raceWithControl(Promise.resolve(result))

              if (resolved instanceof TimeoutError) {
                return resolved
              }

              if (resolved instanceof CancellationError) {
                return resolved
              }

              return resolved as T
            } catch (error) {
              return handleAttemptErrorAsync(error)
            }
          })()
        }

        const timeoutAfterSyncResult = checkDidControlFail()

        if (timeoutAfterSyncResult) {
          return timeoutAfterSyncResult
        }

        return result
      } catch (error) {
        const handled = handleAttemptErrorSync(error)

        if (checkIsSyncRetryContinuation(handled)) {
          currentAttempt = handled.nextAttempt
          continue
        }

        return handled
      }
    }
  }

  try {
    const result = executeAttemptSync(1)

    if (checkIsPromiseLike(result)) {
      return Promise.resolve(result).finally(() => {
        signal.dispose()
        timeout.dispose()
      })
    }

    signal.dispose()
    timeout.dispose()
    return result
  } catch (error) {
    signal.dispose()
    timeout.dispose()
    throw error
  }
}
