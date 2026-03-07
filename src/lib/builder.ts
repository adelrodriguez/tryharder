import type {
  CancellationError,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "./errors"
import type {
  AllOptions,
  AllSettledResult,
  InferredTaskContext,
  TaskRecord,
  TaskResult,
  TaskValidation,
} from "./executors/all"
import type { FlowResult, InferredFlowTaskContext } from "./executors/flow"
import type { BuilderConfig, WrapFn } from "./types/builder"
import type { TryCtxFor } from "./types/core"
import type { RetryOptions } from "./types/retry"
import type { AsyncRunInput, RunTryFn } from "./types/run"
import { Panic } from "./errors"
import { executeAll } from "./executors/all"
import { executeAllSettled } from "./executors/all-settled"
import { executeFlow } from "./executors/flow"
import { executeRun } from "./executors/run"
import { executeRunSync, type SyncRunInput, type SyncRunTryFn } from "./executors/run-sync"
import { createRetryPolicy } from "./modifiers/retry"
import { invariant } from "./utils"

type ConfigRunErrors = RetryExhaustedError | TimeoutError | CancellationError

export class RunBuilder<E extends ConfigRunErrors = never, HasRetry extends boolean = false> {
  readonly #config: BuilderConfig

  constructor(config: BuilderConfig = {}) {
    this.#config = config
  }

  retry(policy: number): Omit<RunBuilder<E | RetryExhaustedError, true>, "wrap">
  retry(policy: RetryOptions): Omit<RunBuilder<E | RetryExhaustedError, true>, "runSync" | "wrap">
  retry(policy: RetryOptions): RunBuilder<E | RetryExhaustedError, true> {
    const limit = typeof policy === "number" ? policy : policy.limit

    invariant(Number.isFinite(limit), new Panic("RETRY_INVALID_LIMIT"))
    invariant(limit >= 0, new Panic("RETRY_INVALID_LIMIT"))

    return new RunBuilder({
      ...this.#config,
      retry: createRetryPolicy(policy),
    })
  }

  timeout(ms: number): Omit<RunBuilder<E | TimeoutError, HasRetry>, "runSync" | "wrap"> {
    invariant(Number.isFinite(ms), new Panic("TIMEOUT_INVALID_MS"))
    invariant(ms >= 0, new Panic("TIMEOUT_INVALID_MS"))

    return new RunBuilder({
      ...this.#config,
      timeout: ms,
    })
  }

  signal(
    signal: AbortSignal
  ): Omit<RunBuilder<E | CancellationError, HasRetry>, "runSync" | "wrap"> {
    return new RunBuilder({
      ...this.#config,
      signals: [...(this.#config.signals ?? []), signal],
    })
  }

  wrap(fn: WrapFn): RunBuilder<E, HasRetry> {
    return new RunBuilder({
      ...this.#config,
      wraps: [...(this.#config.wraps ?? []), fn],
    })
  }

  run<T>(tryFn: RunTryFn<T, TryCtxFor<HasRetry>>): Promise<T | UnhandledException | E>
  run<T, C>(options: AsyncRunInput<T, C, TryCtxFor<HasRetry>>): Promise<T | C | E>
  run<T, C>(input: AsyncRunInput<T, C, TryCtxFor<HasRetry>>) {
    return executeRun(this.#config, input)
  }

  runSync<T>(tryFn: SyncRunTryFn<T, TryCtxFor<HasRetry>>): T | UnhandledException | E
  runSync<T, C>(input: SyncRunInput<T, C, TryCtxFor<HasRetry>>): T | C | E
  runSync<T, C>(input: SyncRunInput<T, C, TryCtxFor<HasRetry>>) {
    return executeRunSync(this.#config, input)
  }

  all<T extends TaskRecord, C = never>(
    tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>,
    options?: AllOptions<T, C>
  ): Promise<{ [K in keyof T]: TaskResult<T[K]> } | C> {
    return executeAll(this.#config, tasks, options)
  }

  allSettled<T extends TaskRecord>(
    tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>
  ): Promise<AllSettledResult<T>> {
    return executeAllSettled(this.#config, tasks)
  }

  flow<T extends TaskRecord>(
    tasks: T & ThisType<InferredFlowTaskContext<T>>
  ): Promise<FlowResult<T>> {
    return executeFlow(this.#config, tasks)
  }
}
