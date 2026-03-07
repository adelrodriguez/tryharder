import type { BuilderConfig } from "../types/builder"
import type { BaseTryCtx } from "../types/core"
import type { AsyncRunInput, RunCatchFn, RunTryFn } from "../types/run"
import { Panic, RetryExhaustedError, UnhandledException } from "../errors"
import { checkIsControlError, checkIsPromiseLike } from "../utils"
import { BaseExecution, RetryDirective, type RetryDecision, type RunnerError } from "./base"

export type { RunnerError } from "./base"

/** Encapsulates the shared mutable state and logic for a single run execution. */
export class RunExecution<T, E, Ctx extends BaseTryCtx> extends BaseExecution<
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

  /** Route a terminal error to the catch handler or wrap in UnhandledException. */
  async #finalizeFailure(error: unknown): Promise<E | RunnerError> {
    if (checkIsControlError(error)) {
      return error
    }

    if (this.#catchFn) {
      let mapped: E | Promise<E>

      try {
        mapped = this.#catchFn(error)
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

    return new UnhandledException(undefined, { cause: error })
  }

  /** Resolve an attempt error into either a terminal result or a retry decision. */
  async #resolveFailure(error: unknown): Promise<E | RunnerError | RetryDirective> {
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
        return new RetryExhaustedError(undefined, { cause: error })
      }

      return await this.#finalizeFailure(error)
    }

    return new RetryDirective(retryDecision)
  }

  async #runAttemptLoop(attempt: number): Promise<T | E | RunnerError> {
    let currentAttempt = attempt
    let currentDecision: RetryDecision | undefined

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const controlBeforeAttempt = this.checkBeforeAttempt()

      if (controlBeforeAttempt) {
        return controlBeforeAttempt
      }

      if (currentDecision) {
        // oxlint-disable-next-line no-await-in-loop
        const delayControlResult = await this.waitForRetryDelay(currentDecision.delay)

        if (delayControlResult) {
          return delayControlResult
        }

        currentDecision = undefined
      }

      this.ctx.retry.attempt = currentAttempt

      try {
        const result = this.#tryFn(this.ctx as unknown as Ctx)

        if (checkIsPromiseLike(result)) {
          // oxlint-disable-next-line no-await-in-loop
          const raced = await this.race(Promise.resolve(result))
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
