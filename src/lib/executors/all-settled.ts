import type {
  AllSettledResult,
  InferredTaskContext,
  TaskRecord,
  TaskValidation,
} from "../types/all"
import type { BuilderConfig } from "../types/builder"
import { OrchestrationExecution, TaskExecution } from "./shared"

class AllSettledExecution<T extends TaskRecord> extends OrchestrationExecution<
  AllSettledResult<T>
> {
  readonly #tasks: T

  constructor(config: BuilderConfig, tasks: T) {
    super(config)
    this.#tasks = tasks
  }

  protected override async executeTasks(): Promise<AllSettledResult<T>> {
    await using execution = new TaskExecution(this.signal.signal, this.#tasks, "settled")
    const result = await this.signal.race(execution.execute())
    const cancellation = this.signal.checkDidCancel()

    if (cancellation) {
      throw cancellation
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
