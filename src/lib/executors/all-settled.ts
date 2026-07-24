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

  protected override executeTasks(): Promise<AllSettledResult<T>> {
    return this.executeTaskGraph(new TaskExecution(this.executionSignal, this.#tasks, "settled"), {
      waitForTasksToSettle: false,
    })
  }
}

export async function executeAllSettled<T extends TaskRecord>(
  config: BuilderConfig,
  tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>
): Promise<AllSettledResult<T>> {
  using execution = new AllSettledExecution(config, tasks)
  return await execution.execute()
}
