import type { BuilderConfig } from "../builder"
import type {
  AllSettledResult,
  InferredTaskContext,
  TaskRecord,
  TaskValidation,
} from "./task-graph"
import { OrchestrationExecution, SettledTaskExecution } from "./task-graph"

class AllSettledExecution<T extends TaskRecord> extends OrchestrationExecution<
  AllSettledResult<T>
> {
  readonly #tasks: T

  constructor(config: BuilderConfig, tasks: T) {
    super(config)
    this.#tasks = tasks
  }

  protected override executeTasks(): Promise<AllSettledResult<T>> {
    return this.executeTaskGraph(new SettledTaskExecution(this.executionSignal, this.#tasks))
  }
}

export async function executeAllSettled<T extends TaskRecord>(
  config: BuilderConfig,
  tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>
): Promise<AllSettledResult<T>> {
  using execution = new AllSettledExecution(config, tasks)
  return await execution.execute()
}
