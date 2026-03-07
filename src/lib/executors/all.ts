import type {
  AllOptions,
  AllValue,
  InferredTaskContext,
  TaskRecord,
  TaskResult,
  TaskValidation,
} from "../types/all"
import type { BuilderConfig } from "../types/builder"
import { CancellationError, Panic } from "../errors"
import { checkIsPromiseLike } from "../utils"
import { OrchestrationExecution, TaskExecution } from "./shared"

class AllExecution<T extends TaskRecord, C> extends OrchestrationExecution<AllValue<T> | C> {
  readonly #tasks: T
  readonly #options: AllOptions<T, C> | undefined

  constructor(config: BuilderConfig, tasks: T, options?: AllOptions<T, C>) {
    super(config)
    this.#tasks = tasks
    this.#options = options
  }

  protected override async executeTasks(): Promise<AllValue<T> | C> {
    await using execution = new TaskExecution(this.signal.signal, this.#tasks, "fail-fast")

    try {
      const result = await this.signal.race(execution.execute())
      const cancellation = this.signal.checkDidCancel()

      if (cancellation) {
        throw cancellation
      }

      return result as AllValue<T>
    } catch (error) {
      const controlAfterFailure = this.checkDidControlFail(error)

      if (controlAfterFailure) {
        throw controlAfterFailure
      }

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
        const raced = await this.signal.race(
          Promise.resolve(mapped).catch((catchError: unknown) => {
            if (catchError instanceof CancellationError) {
              throw catchError
            }

            throw new Panic("ALL_CATCH_HANDLER_REJECT", { cause: catchError })
          }),
          error
        )
        const cancellation = this.signal.checkDidCancel(error)

        if (cancellation) {
          throw cancellation
        }

        return raced as C
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
