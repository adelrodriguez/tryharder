import type { BuilderConfig } from "../builder"
import { CancellationError, Panic } from "../errors"
import { checkIsPromiseLike } from "../utils"
import {
  OrchestrationExecution,
  TaskExecution,
  type AllOptions,
  type AllValue,
  type InferredTaskContext,
  type TaskGraphFailureOutcome,
  type TaskRecord,
  type TaskResult,
  type TaskValidation,
} from "./shared"

class AllExecution<T extends TaskRecord, C> extends OrchestrationExecution<AllValue<T> | C> {
  readonly #tasks: T
  readonly #options: AllOptions<T, C> | undefined

  constructor(config: BuilderConfig, tasks: T, options?: AllOptions<T, C>) {
    super(config)
    this.#tasks = tasks
    this.#options = options
  }

  protected override executeTasks(): Promise<AllValue<T> | C> {
    const execution = new TaskExecution(this.executionSignal, this.#tasks, "fail-fast")

    return this.executeTaskGraph<AllValue<T> | C>(execution, {
      mapFailure: (error) => this.#mapFailure(execution, error),
    })
  }

  async #mapFailure(
    execution: TaskExecution<T, "fail-fast">,
    error: unknown
  ): Promise<TaskGraphFailureOutcome<AllValue<T> | C>> {
    const controlAfterFailure = this.checkDidControlFail(error)
    const catchFn = this.#options?.catch

    if (controlAfterFailure) {
      return { thrown: controlAfterFailure }
    }

    if (!catchFn) {
      return { thrown: error }
    }

    const context = {
      failedTask: execution.failedTask,
      partial: execution.returnValue as Partial<AllValue<T>>,
      signal: execution.signal,
    }

    try {
      const mapped = catchFn(error, context)

      if (!checkIsPromiseLike(mapped)) {
        return { mapped }
      }

      try {
        const raced = (await this.raceWithCancellation(
          Promise.resolve(mapped).catch((catchError: unknown) => {
            if (catchError instanceof CancellationError) {
              throw catchError
            }

            throw new Panic("ALL_CATCH_HANDLER_REJECT", { cause: catchError })
          }),
          error
        )) as C

        return { mapped: raced }
      } catch (mappedError) {
        return { thrown: mappedError }
      }
    } catch (catchError) {
      return { thrown: new Panic("ALL_CATCH_HANDLER_THROW", { cause: catchError }) }
    }
  }
}

export async function executeAll<T extends TaskRecord, C = never>(
  config: BuilderConfig,
  tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>,
  options?: AllOptions<T, C>
): Promise<{ [K in keyof T]: TaskResult<T[K]> } | C> {
  using execution = new AllExecution(config, tasks, options)
  return await execution.execute()
}
