import type {
  AllOptions,
  InferredTaskContext,
  TaskRecord,
  TaskResult,
  TaskValidation,
} from "./types/all"
import type { BuilderConfig } from "./types/builder"
import { executeAllCore } from "./all.shared"

export function executeAll<T extends TaskRecord>(
  config: BuilderConfig,
  tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>
): Promise<{ [K in keyof T]: TaskResult<T[K]> }>
export function executeAll<T extends TaskRecord, C>(
  config: BuilderConfig,
  tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>,
  options: AllOptions<T, C>
): Promise<{ [K in keyof T]: TaskResult<T[K]> } | C>
export function executeAll<T extends TaskRecord, C>(
  config: BuilderConfig,
  tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>,
  options?: AllOptions<T, C>
): Promise<{ [K in keyof T]: TaskResult<T[K]> } | C> {
  return executeAllCore(config, tasks, false, options) as Promise<
    { [K in keyof T]: TaskResult<T[K]> } | C
  >
}

export type {
  AllCatchContext,
  AllCatchFn,
  AllOptions,
  AllSettledResult,
  AllValue,
  InferredTaskContext,
  ResultProxy,
  SettledFulfilled,
  SettledRejected,
  SettledResult,
  TaskContext,
  TaskRecord,
  TaskResult,
  TaskValidation,
} from "./types/all"
