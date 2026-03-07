import type {
  AllSettledResult,
  InferredTaskContext,
  SettledResult,
  TaskRecord,
  TaskValidation,
} from "../types/all"
import type { BuilderConfig } from "../types/builder"
import { CancellationError, TimeoutError } from "../errors"
import { checkIsControlError } from "../utils"
import { BaseExecution } from "./base"
import { TaskExecution } from "./shared"

class AllSettledExecution<T extends TaskRecord> extends BaseExecution<
  Promise<AllSettledResult<T>>
> {
  readonly #tasks: T

  constructor(config: BuilderConfig, tasks: T) {
    super(config)
    this.#tasks = tasks
  }

  protected override async executeCore(): Promise<AllSettledResult<T>> {
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

        const settled = result
        const firstRejection = AllSettledExecution.#findFirstRejection(settled)

        // All tasks fulfilled — return results
        if (firstRejection === undefined) {
          return settled
        }

        // Some tasks rejected — check retry policy
        const retryDecision = this.buildRetryDecision(firstRejection)

        if (!retryDecision.shouldAttemptRetry) {
          // Retries exhausted or shouldRetry returned false — return settled results
          return settled
        }

        // oxlint-disable-next-line no-await-in-loop
        const delayControlResult = await this.waitForRetryDelay(retryDecision.delay)

        if (delayControlResult) {
          throw delayControlResult
        }

        currentAttempt += 1
      } catch (error) {
        if (checkIsControlError(error)) {
          throw error
        }

        const controlAfterFailure = this.checkDidControlFail(error)

        if (controlAfterFailure) {
          throw controlAfterFailure
        }

        throw error
      }
    }
  }

  async #executeAttempt(): Promise<AllSettledResult<T> | CancellationError | TimeoutError> {
    await using execution = new TaskExecution(this.signal.signal, this.#tasks, "settled")
    const result = await this.race(execution.execute())

    if (result instanceof CancellationError || result instanceof TimeoutError) {
      return result
    }

    return result as AllSettledResult<T>
  }

  static #findFirstRejection<T extends TaskRecord>(settled: AllSettledResult<T>): unknown {
    for (const key of Object.keys(settled)) {
      const entry = settled[key] as SettledResult<unknown>

      if (entry.status === "rejected") {
        return entry.reason
      }
    }

    return undefined
  }
}

export async function executeAllSettled<T extends TaskRecord>(
  config: BuilderConfig,
  tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>
): Promise<AllSettledResult<T>> {
  using execution = new AllSettledExecution(config, tasks)
  return await execution.execute()
}
