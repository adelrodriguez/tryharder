import type { CancellationError, TimeoutError } from "./errors"
import type { BuilderConfig } from "./types/builder"
import type {
  AsyncRunCatchFn,
  AsyncRunTryFn,
  RunInput,
  RunCatchFn,
  SyncRunCatchFn,
  SyncRunTryFn,
} from "./types/run"
import { createContext } from "./context"
import { Panic, RetryExhaustedError, UnhandledException } from "./errors"
import { calculateRetryDelay, checkIsRetryExhausted, checkShouldAttemptRetry } from "./retry"
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

const CONTINUE_SYNC = Symbol("CONTINUE_SYNC")

type SyncRetryContinuation = {
  [CONTINUE_SYNC]: true
  nextAttempt: number
}

function isSyncRetryContinuation(value: unknown): value is SyncRetryContinuation {
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

// -- Overloads: narrow the return type based on whether the input is sync/async
// and whether a catch handler is provided. --

export function executeRun<T>(
  config: BuilderConfig,
  input: SyncRunTryFn<T>
): T | UnhandledException | Promise<T | UnhandledException>
export function executeRun<T>(
  config: BuilderConfig,
  input: AsyncRunTryFn<T>
): Promise<T | UnhandledException>
export function executeRun<T, E>(
  config: BuilderConfig,
  input: { try: SyncRunTryFn<T>; catch: SyncRunCatchFn<E> }
): T | E | Promise<T | E>
export function executeRun<T, E>(
  config: BuilderConfig,
  input:
    | { try: SyncRunTryFn<T>; catch: AsyncRunCatchFn<E> }
    | { try: AsyncRunTryFn<T>; catch: RunCatchFn<E> }
): Promise<T | E>
export function executeRun<T, E>(
  config: BuilderConfig,
  input: RunInput<T, E>
): T | E | RunnerError | Promise<T | E | RunnerError>

/**
 * Core execution engine. Runs the try function with optional retry, catch, and
 * timeout support. Stays synchronous when possible and only becomes async when
 * the try function returns a promise or a retry delay is needed.
 */
export function executeRun<T, E>(config: BuilderConfig, input: RunInput<T, E>) {
  const ctx = createContext(config)

  // Normalize input: accept either a bare function or a { try, catch } object.
  const catchFn = typeof input === "function" ? undefined : input.catch
  const tryFn = typeof input === "function" ? input : input.try

  /**
   * Terminal error handler. Called when no more retries will happen.
   * Routes the error to the catch handler, or wraps it in UnhandledException
   * if no catch was provided. Control errors (Panic, Timeout, Cancellation)
   * always pass through unchanged.
   */
  const finalizeError = (error: unknown): E | RunnerError | Promise<E> => {
    if (checkIsControlError(error)) {
      return error
    }

    if (catchFn) {
      return executeCatch(catchFn, error)
    }

    return new UnhandledException({ cause: error })
  }

  const evaluateRetryDecision = (error: unknown, attempt: number): RetryDecision => {
    const shouldAttemptRetry = checkShouldAttemptRetry(error, attempt, config)

    return {
      delay: shouldAttemptRetry ? calculateRetryDelay(attempt, config) : 0,
      isRetryExhausted: checkIsRetryExhausted(attempt, config),
      shouldAttemptRetry,
    }
  }

  /**
   * Handle a failed attempt in the synchronous path.
   *
   * Decides whether to retry, finalize the error, or switch to the async path
   * (when a non-zero delay is required between retries).
   */
  const handleAttemptErrorSync = (
    error: unknown,
    attempt: number
  ): T | E | RunnerError | Promise<T | E | RunnerError> | SyncRetryContinuation => {
    // Control errors (Panic, Timeout, Cancellation) are never retried.
    if (checkIsControlError(error)) {
      return error
    }

    const retryDecision = evaluateRetryDecision(error, attempt)

    if (!retryDecision.shouldAttemptRetry) {
      // All retries used up -- return a RetryExhaustedError (skips catch).
      if (retryDecision.isRetryExhausted) {
        return new RetryExhaustedError({ cause: error })
      }

      // Either no retry policy or shouldRetry returned false -- finalize.
      return finalizeError(error)
    }

    // No delay needed -- stay on the synchronous path for the next attempt.
    if (retryDecision.delay <= 0) {
      return { [CONTINUE_SYNC]: true, nextAttempt: attempt + 1 }
    }

    // A delay is required, so we must switch to the async retry loop.
    return handleAttemptErrorAsync(error, attempt, retryDecision)
  }

  /**
   * Handle a failed attempt in the asynchronous path.
   *
   * Awaits the retry delay, then recursively retries. Once we enter the async
   * path we stay async for all subsequent attempts.
   */
  const handleAttemptErrorAsync = async (
    error: unknown,
    attempt: number,
    retryDecision?: RetryDecision
  ): Promise<T | E | RunnerError> => {
    // Same early exits as the sync path.
    if (checkIsControlError(error)) {
      return error
    }

    const decision = retryDecision ?? evaluateRetryDecision(error, attempt)

    if (!decision.shouldAttemptRetry) {
      if (decision.isRetryExhausted) {
        return new RetryExhaustedError({ cause: error })
      }

      return finalizeError(error)
    }

    // Wait for the backoff delay before the next attempt.
    if (decision.delay > 0) {
      await sleep(decision.delay)
    }

    const nextAttempt = attempt + 1
    ctx.retry.attempt = nextAttempt

    try {
      return await tryFn(ctx)
    } catch (attemptError) {
      return handleAttemptErrorAsync(attemptError, nextAttempt)
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

    // eslint-disable-next-line typescript-eslint/no-unnecessary-condition
    while (true) {
      ctx.retry.attempt = currentAttempt

      try {
        const result = tryFn(ctx)

        // The try function returned a promise -- handle rejections asynchronously.
        if (checkIsPromiseLike(result)) {
          const attemptForPromise = currentAttempt

          return Promise.resolve(result).catch((error: unknown) =>
            handleAttemptErrorAsync(error, attemptForPromise)
          )
        }

        return result
      } catch (error) {
        const handled = handleAttemptErrorSync(error, currentAttempt)

        if (isSyncRetryContinuation(handled)) {
          currentAttempt = handled.nextAttempt
          continue
        }

        return handled
      }
    }
  }

  // Retry execution can switch to async even from sync inputs.
  const result = executeAttemptSync(1)

  if (config.retry) {
    return Promise.resolve(result)
  }

  return result
}
