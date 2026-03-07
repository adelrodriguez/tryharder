import type { BuilderConfig } from "../builder"
import type {
  AllOptions,
  AllValue,
  InferredTaskContext,
  TaskRecord,
  TaskResult,
  TaskValidation,
} from "./shared"
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
    await using execution = new TaskExecution(this.executionSignal, this.#tasks, "fail-fast")
    let result!: AllValue<T> | C
    let threw = false
    let thrownError: unknown

    try {
      result = (await this.raceWithCancellation(execution.execute())) as AllValue<T>
    } catch (error) {
      const controlAfterFailure = this.checkDidControlFail(error)
      const catchFn = this.#options?.catch

      if (controlAfterFailure) {
        threw = true
        thrownError = controlAfterFailure
      } else if (catchFn) {
        const context = {
          failedTask: execution.failedTask,
          partial: execution.returnValue as Partial<AllValue<T>>,
          signal: execution.signal,
        }

        try {
          const mapped = catchFn(error, context)
          if (checkIsPromiseLike(mapped)) {
            try {
              result = (await this.raceWithCancellation(
                Promise.resolve(mapped).catch((catchError: unknown) => {
                  if (catchError instanceof CancellationError) {
                    throw catchError
                  }

                  throw new Panic("ALL_CATCH_HANDLER_REJECT", { cause: catchError })
                }),
                error
              )) as C
            } catch (mappedError) {
              threw = true
              thrownError = mappedError
            }
          } else {
            result = mapped
          }
        } catch (catchError) {
          threw = true
          thrownError = new Panic("ALL_CATCH_HANDLER_THROW", { cause: catchError })
        }
      } else {
        threw = true
        thrownError = error
      }
    } finally {
      await execution.waitForTasksToSettle()
    }

    const cancellation = this.checkDidCancel(thrownError)

    if (cancellation) {
      throw cancellation
    }

    if (threw) {
      throw thrownError
    }

    return result
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
