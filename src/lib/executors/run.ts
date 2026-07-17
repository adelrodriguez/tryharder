import type { BuilderConfig } from "../builder"
import type { BaseTryCtx, NonPromise } from "./shared"
import { Panic, type UnhandledException } from "../errors"
import { checkIsPromiseLike } from "../utils"
import { BaseExecution, RetryDirective, type RetryDecision, type RunnerError } from "./base"

export type RunTryFn<T, Ctx extends BaseTryCtx = BaseTryCtx> = (
  ctx: Ctx
) => NonPromise<T> | Promise<T>

type RunCatchFn<E> = (error: unknown) => NonPromise<E> | Promise<E>

interface RunAsyncOptions<T, E, Ctx extends BaseTryCtx = BaseTryCtx> {
  try: RunTryFn<T, Ctx>
  /**
   * Maps errors that originated inside `try` — thrown directly, or carried out of the retry loop as
   * the last attempt's error once the retry policy gives up. Never invoked for policy outcomes
   * (timeout, cancellation) or defects (`Panic`).
   */
  catch: RunCatchFn<E>
}

export type AsyncRunInput<T, E, Ctx extends BaseTryCtx = BaseTryCtx> =
  | RunTryFn<T, Ctx>
  | RunAsyncOptions<T, E, Ctx>

/**
 * Encapsulates the shared mutable state and logic for a single run execution.
 */
class RunExecution<T, E, Ctx extends BaseTryCtx> extends BaseExecution<
  Promise<T | E | RunnerError>
> {
  #catchFn: RunCatchFn<E> | undefined
  #tryFn: RunTryFn<T, Ctx>

  constructor(config: BuilderConfig, input: AsyncRunInput<T, E, Ctx>) {
    super(config)

    this.#catchFn = typeof input === "function" ? undefined : input.catch
    this.#tryFn = typeof input === "function" ? input : input.try
  }

  protected override executeCore(): Promise<T | E | RunnerError> {
    return this.#runAttemptLoop(1)
  }

  /**
   * Resolve an attempt error into either a terminal result or a retry decision.
   */
  async #resolveFailure(error: unknown): Promise<E | RunnerError | RetryDirective> {
    const resolved = this.resolveControlOrRetry(error)

    if (resolved) {
      return resolved
    }

    const catchFn = this.#catchFn

    if (!catchFn) {
      return this.resolveUnmappedFailure(error)
    }

    let mapped: E | Promise<E>

    try {
      mapped = catchFn(error)
    } catch (catchError) {
      throw new Panic("RUN_CATCH_HANDLER_THROW", { cause: catchError })
    }

    if (checkIsPromiseLike(mapped)) {
      try {
        return await this.race(mapped, error)
      } catch (catchError) {
        throw new Panic("RUN_CATCH_HANDLER_REJECT", { cause: catchError })
      }
    }

    // Control state can change while the catch handler runs, so check again
    // before returning a mapped sync value.
    const catchControlError = this.checkDidControlFail(error)

    if (catchControlError) {
      return catchControlError
    }

    return mapped
  }

  async #runAttemptLoop(attempt: number): Promise<T | E | RunnerError> {
    let currentAttempt = attempt
    let currentDecision: RetryDecision | undefined

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const controlBeforeAttempt = this.checkDidControlFail()

      if (controlBeforeAttempt) {
        return controlBeforeAttempt
      }

      if (currentDecision) {
        // oxlint-disable-next-line no-await-in-loop
        const delayControlResult = await this.waitForRetryDelay(currentDecision.delay)

        if (delayControlResult) {
          return delayControlResult
        }
      }

      this.ctx.retry.attempt = currentAttempt

      try {
        const result = this.#tryFn(this.ctx as unknown as Ctx)

        if (checkIsPromiseLike(result)) {
          // oxlint-disable-next-line no-await-in-loop
          const raced = await this.race(result)
          return raced
        }

        return this.resolveSyncSuccess(result)
      } catch (attemptError) {
        // oxlint-disable-next-line no-await-in-loop
        const resolved = await this.#resolveFailure(attemptError)

        if (!(resolved instanceof RetryDirective)) {
          return resolved
        }

        currentDecision = resolved.decision
        currentAttempt += 1
      }
    }
  }
}

export function executeRun<T, Ctx extends BaseTryCtx>(
  config: BuilderConfig,
  input: RunTryFn<T, Ctx>
): Promise<T | UnhandledException>
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
