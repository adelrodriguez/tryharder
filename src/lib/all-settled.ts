import type { AllSettledResult, InferredTaskContext, TaskRecord, TaskValidation } from "./types/all"
import type { BuilderConfig } from "./types/builder"
import { executeAllCore } from "./all.shared"

export function executeAllSettled<T extends TaskRecord>(
  config: BuilderConfig,
  tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>
): Promise<AllSettledResult<T>> {
  return executeAllCore(config, tasks, true) as Promise<AllSettledResult<T>>
}
