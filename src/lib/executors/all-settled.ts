import type { BuilderConfig } from "../builder"
import type { AllSettledResult, InferredTaskContext, TaskRecord, TaskValidation } from "./shared"
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
    await using execution = new TaskExecution(this.executionSignal, this.#tasks, "settled")
    const result = await this.raceWithCancellation(execution.execute())
    const cancellation = this.checkDidCancel()

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
