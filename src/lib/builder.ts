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
} from "./types/all"
import type { BuilderConfig, WrapFn } from "./types/builder"
import type { TryCtxFor } from "./types/core"
import type { FlowResult, InferredFlowTaskContext } from "./types/flow"
import type { RetryOptions } from "./types/retry"
import type { AsyncRunInput, RunTryFn } from "./types/run"
import { Panic } from "./errors"
import { executeAll } from "./executors/all"
import { executeAllSettled } from "./executors/all-settled"
import { executeFlow } from "./executors/flow"
import { executeRun } from "./executors/run"
import { executeRunSync, type SyncRunInput, type SyncRunTryFn } from "./executors/run-sync"
import { retryOptions } from "./modifiers/retry"
import { invariant } from "./utils"

type ConfigRunErrors = RetryExhaustedError | TimeoutError | CancellationError
type OrchestrationMethods = "all" | "allSettled" | "flow"
type SignalBuilderHiddenMethods<SupportsOrchestration extends boolean> =
  | "runSync"
  | "wrap"
  | (SupportsOrchestration extends true ? never : OrchestrationMethods)
type ExecutionBuilderSurface<E extends ConfigRunErrors, HasRetry extends boolean> = Omit<
  RunBuilder<E, HasRetry, false>,
  OrchestrationMethods | "wrap"
>
type AsyncExecutionBuilderSurface<E extends ConfigRunErrors, HasRetry extends boolean> = Omit<
  RunBuilder<E, HasRetry, false>,
  OrchestrationMethods | "runSync" | "wrap"
>
type SignalBuilderSurface<
  E extends ConfigRunErrors,
  HasRetry extends boolean,
  SupportsOrchestration extends boolean,
> = Omit<
  RunBuilder<E, HasRetry, SupportsOrchestration>,
  SignalBuilderHiddenMethods<SupportsOrchestration>
>

export class RunBuilder<
  E extends ConfigRunErrors = never,
  HasRetry extends boolean = false,
  SupportsOrchestration extends boolean = true,
> {
  protected readonly config: BuilderConfig

  constructor(config: BuilderConfig = {}) {
    this.config = config
  }

  protected buildRetryConfig(policy: RetryOptions): BuilderConfig {
    const limit = typeof policy === "number" ? policy : policy.limit

    invariant(Number.isFinite(limit), new Panic("RETRY_INVALID_LIMIT"))
    invariant(limit >= 0, new Panic("RETRY_INVALID_LIMIT"))

    return {
      ...this.config,
      retry: retryOptions(policy),
    }
  }

  protected buildTimeoutConfig(ms: number): BuilderConfig {
    invariant(Number.isFinite(ms), new Panic("TIMEOUT_INVALID_MS"))
    invariant(ms >= 0, new Panic("TIMEOUT_INVALID_MS"))

    return {
      ...this.config,
      timeout: ms,
    }
  }

  protected buildSignalConfig(signal: AbortSignal): BuilderConfig {
    return {
      ...this.config,
      signals: [...(this.config.signals ?? []), signal],
    }
  }

  retry(policy: number): ExecutionBuilderSurface<E | RetryExhaustedError, true>
  retry(policy: RetryOptions): AsyncExecutionBuilderSurface<E | RetryExhaustedError, true>
  retry(policy: RetryOptions): ExecutionBuilderSurface<E | RetryExhaustedError, true> {
    return new ExecutionBuilder(this.buildRetryConfig(policy))
  }

  timeout(ms: number): AsyncExecutionBuilderSurface<E | TimeoutError, HasRetry> {
    return new ExecutionBuilder(this.buildTimeoutConfig(ms))
  }

  signal(
    signal: AbortSignal
  ): SignalBuilderSurface<E | CancellationError, HasRetry, SupportsOrchestration> {
    if (this instanceof ExecutionBuilder) {
      return new ExecutionBuilder(
        this.buildSignalConfig(signal)
      ) as unknown as SignalBuilderSurface<E | CancellationError, HasRetry, SupportsOrchestration>
    }

    return new RunBuilder(this.buildSignalConfig(signal)) as unknown as SignalBuilderSurface<
      E | CancellationError,
      HasRetry,
      SupportsOrchestration
    >
  }

  wrap(fn: WrapFn): RunBuilder<E, HasRetry, SupportsOrchestration> {
    return new RunBuilder({
      ...this.config,
      wraps: [...(this.config.wraps ?? []), fn],
    })
  }

  run<T>(tryFn: RunTryFn<T, TryCtxFor<HasRetry>>): Promise<T | UnhandledException | E>
  run<T, C>(options: AsyncRunInput<T, C, TryCtxFor<HasRetry>>): Promise<T | C | E>
  run<T, C>(input: AsyncRunInput<T, C, TryCtxFor<HasRetry>>) {
    return executeRun(this.config, input)
  }

  runSync<T>(tryFn: SyncRunTryFn<T, TryCtxFor<HasRetry>>): T | UnhandledException | E
  runSync<T, C>(input: SyncRunInput<T, C, TryCtxFor<HasRetry>>): T | C | E
  runSync<T, C>(input: SyncRunInput<T, C, TryCtxFor<HasRetry>>) {
    return executeRunSync(this.config, input)
  }

  all<T extends TaskRecord, C = never>(
    tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>,
    options?: AllOptions<T, C>
  ): Promise<{ [K in keyof T]: TaskResult<T[K]> } | C> {
    return executeAll(this.config, tasks, options)
  }

  allSettled<T extends TaskRecord>(
    tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>
  ): Promise<AllSettledResult<T>> {
    return executeAllSettled(this.config, tasks)
  }

  flow<T extends TaskRecord>(
    tasks: T & ThisType<InferredFlowTaskContext<T>>
  ): Promise<FlowResult<T>> {
    return executeFlow(this.config, tasks)
  }
}

class ExecutionBuilder<
  E extends ConfigRunErrors = never,
  HasRetry extends boolean = false,
> extends RunBuilder<E, HasRetry, false> {
  constructor(config: BuilderConfig = {}) {
    super(config)

    // Retry/timeout chains must not silently keep orchestration entrypoints at
    // runtime, even though the type surface already removes them.
    Object.defineProperties(this, {
      all: { configurable: true, value: undefined, writable: false },
      allSettled: { configurable: true, value: undefined, writable: false },
      flow: { configurable: true, value: undefined, writable: false },
      wrap: { configurable: true, value: undefined, writable: false },
    })
  }
}
