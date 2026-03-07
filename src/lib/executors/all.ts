import type {
  AllOptions,
  AllValue,
  InferredTaskContext,
  TaskRecord,
  TaskResult,
  TaskValidation,
} from "../types/all"
import type { BuilderConfig } from "../types/builder"
import { CancellationError, Panic, RetryExhaustedError, TimeoutError } from "../errors"
import { checkIsControlError, checkIsPromiseLike } from "../utils"
import { BaseExecution } from "./base"
import { TaskExecution } from "./shared"

class AllExecution<T extends TaskRecord, C> extends BaseExecution<Promise<AllValue<T> | C>> {
  readonly #tasks: T
  readonly #options: AllOptions<T, C> | undefined

  constructor(config: BuilderConfig, tasks: T, options?: AllOptions<T, C>) {
    super(config)
    this.#tasks = tasks
    this.#options = options
  }

  protected override async executeCore(): Promise<AllValue<T> | C> {
    let currentAttempt = 1

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const controlBeforeAttempt = this.checkDidControlFail()

      if (controlBeforeAttempt) {
        throw controlBeforeAttempt
      }

      this.ctx.retry.attempt = currentAttempt

      try {
        // oxlint-disable-next-line no-await-in-loop
        const result = await this.#executeAttempt()

        if (result instanceof CancellationError || result instanceof TimeoutError) {
          throw result
        }

        return result
      } catch (error) {
        if (checkIsControlError(error)) {
          throw error
        }

        const controlAfterFailure = this.checkDidControlFail(error)

        if (controlAfterFailure) {
          throw controlAfterFailure
        }

        const retryDecision = this.buildRetryDecision(error)

        if (!retryDecision.shouldAttemptRetry) {
          if (retryDecision.isRetryExhausted) {
            throw new RetryExhaustedError(undefined, { cause: error })
          }

          throw error
        }

        // oxlint-disable-next-line no-await-in-loop
        const delayControlResult = await this.waitForRetryDelay(retryDecision.delay)

        if (delayControlResult) {
          throw delayControlResult
        }

        currentAttempt += 1
      }
    }
  }

  async #executeAttempt(): Promise<AllValue<T> | C | CancellationError | TimeoutError> {
    await using execution = new TaskExecution(this.signal.signal, this.#tasks, "fail-fast")

    try {
      const result = await this.race(execution.execute())

      if (result instanceof CancellationError || result instanceof TimeoutError) {
        return result
      }

      return result as AllValue<T>
    } catch (error) {
      if (!this.#options?.catch) {
        throw error
      }

      const catchFn = this.#options.catch
      const context = {
        failedTask: execution.failedTask,
        partial: execution.returnValue as Partial<AllValue<T>>,
        signal: execution.signal,
      }

      let mapped: C | Promise<C>

      try {
        mapped = catchFn(error, context)
      } catch (catchError) {
        throw new Panic("ALL_CATCH_HANDLER_THROW", { cause: catchError })
      }

      if (checkIsPromiseLike(mapped)) {
        const raced = await this.race(
          Promise.resolve(mapped).catch((catchError: unknown) => {
            if (catchError instanceof CancellationError || catchError instanceof TimeoutError) {
              throw catchError
            }

            throw new Panic("ALL_CATCH_HANDLER_REJECT", { cause: catchError })
          }),
          error
        )

        if (raced instanceof CancellationError || raced instanceof TimeoutError) {
          throw raced
        }

        return raced
      }

      return mapped
    }
  }
}

export async function executeAll<T extends TaskRecord, C = never>(
  config: BuilderConfig,
  tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>,
  options?: AllOptions<T, C>
): Promise<{ [K in keyof T]: TaskResult<T[K]> } | C> {
  using execution = new AllExecution(config, tasks, options)
  return (await execution.execute()) as { [K in keyof T]: TaskResult<T[K]> } | C
}

export type {
  AllCatchContext,
  AllCatchFn,
  AllOptions,
  AllSettledResult,
  AllValue,
  InferredTaskContext,
  ResultProxy,
  SettledFulfilled,
  SettledRejected,
  SettledResult,
  TaskContext,
  TaskRecord,
  TaskResult,
  TaskValidation,
} from "../types/all"
