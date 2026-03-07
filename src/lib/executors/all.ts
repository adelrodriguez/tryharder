import type {
  AllOptions,
  AllValue,
  InferredTaskContext,
  TaskRecord,
  TaskResult,
  TaskValidation,
} from "../types/all"
import type { BuilderConfig } from "../types/builder"
import { CancellationError, Panic, TimeoutError } from "../errors"
import { checkIsPromiseLike } from "../utils"
import { BaseExecution } from "./base"
import { TaskExecution } from "./shared"

class AllExecution<T extends TaskRecord, C> extends BaseExecution<Promise<AllValue<T> | C>> {
  readonly #tasks: T
  readonly #options: AllOptions<T, C> | undefined

  constructor(config: BuilderConfig, tasks: T, options?: AllOptions<T, C>) {
    super(config, { retryLimit: 1 })
    this.#tasks = tasks
    this.#options = options
  }

  protected override async executeCore(): Promise<AllValue<T> | C> {
    await using execution = new TaskExecution(this.signal.signal, this.#tasks, "fail-fast")

    try {
      const result = await this.timeout.race(execution.execute())

      if (result instanceof TimeoutError) {
        throw result
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
        try {
          const raced = await this.race(mapped, error)

          if (raced instanceof CancellationError || raced instanceof TimeoutError) {
            throw raced
          }

          return raced
        } catch (catchError) {
          if (catchError instanceof CancellationError || catchError instanceof TimeoutError) {
            throw catchError
          }

          throw new Panic("ALL_CATCH_HANDLER_REJECT", { cause: catchError })
        }
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
