import type {
  AllSettledResult,
  InferredTaskContext,
  TaskRecord,
  TaskValidation,
} from "../types/all"
import type { BuilderConfig } from "../types/builder"
import { TimeoutError } from "../errors"
import { BaseExecution } from "./base"
import { TaskExecution } from "./shared"

class AllSettledExecution<T extends TaskRecord> extends BaseExecution<
  Promise<AllSettledResult<T>>
> {
  readonly #tasks: T

  constructor(config: BuilderConfig, tasks: T) {
    super(config, { retryLimit: 1 })
    this.#tasks = tasks
  }

  protected override async executeCore(): Promise<AllSettledResult<T>> {
    await using execution = new TaskExecution(this.signal.signal, this.#tasks, "settled")
    const result = await this.timeout.race(execution.execute())

    if (result instanceof TimeoutError) {
      throw result
    }

    return result as AllSettledResult<T>
  }
}

export async function executeAllSettled<T extends TaskRecord>(
  config: BuilderConfig,
  tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>
): Promise<AllSettledResult<T>> {
  using execution = new AllSettledExecution(config, tasks)
  return await execution.execute()
}
