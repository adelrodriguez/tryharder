import type {
  CancellationError,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "./errors"
import type {
  InferredTaskContext,
  TaskRecord,
  TaskResult,
  TaskValidation,
  AllOptions,
  AllSettledResult,
  TryCtx,
  TryCtxFor,
} from "./executors/shared"
import type { RetryOptions, RetryPolicy, ValidateRetryLimit } from "./modifiers/retry"
import { executeAll } from "./executors/all"
import { executeAllSettled } from "./executors/all-settled"
import { executeFlow, type FlowResult, type InferredFlowTaskContext } from "./executors/flow"
import { executeRun, type AsyncRunInput, type RunTryFn } from "./executors/run"
import { executeRunSync, type SyncRunInput, type SyncRunTryFn } from "./executors/run-sync"
import { retryOptions } from "./modifiers/retry"
import { assertValidTimeout } from "./modifiers/timeout"

/**
 * Wraps are observational hooks: they can inspect execution context and surround execution, but
 * they must not mutate context or replace it.
 */
export type WrapCtx = Readonly<Omit<TryCtx, "retry">> & {
  readonly retry: Readonly<TryCtx["retry"]>
}

type WrapFn = (ctx: WrapCtx, next: () => unknown) => unknown

export interface BuilderConfig {
  /**
   * Retry configuration applied to the run.
   */
  retry?: RetryPolicy
  /**
   * Timeout configuration applied to the run.
   */
  timeout?: number
  /**
   * Abort signals used to cancel execution.
   */
  signals?: AbortSignal[]
  /**
   * Wrapper middleware chain around execution.
   */
  wraps?: WrapFn[]
}

type ConfigRunErrors = TimeoutError | CancellationError
/**
 * The failure type for try functions without a catch handler. With retry configured, any give-up
 * (limit exhausted or `shouldRetry` declining) is reported as {@link RetryExhaustedError} carrying
 * the last attempt's error as `cause`; otherwise failures are wrapped in {@link UnhandledException}.
 */
type UnmappedError<HasRetry extends boolean> = HasRetry extends true
  ? RetryExhaustedError
  : UnhandledException
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

  protected buildTimeoutConfig(ms: number): BuilderConfig {
    assertValidTimeout(ms)

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

  // Runtime note: there is a single builder class. Policy misuse that the
  // narrowed type surfaces prevent (e.g. calling all() after retry() from
  // untyped code) is guarded at execution time by OrchestrationExecution's
  // ORCHESTRATION_UNSUPPORTED_POLICY panic, and wrap ordering is
  // behavior-invariant (wraps always cover the full retry scope), so no
  // runtime method-hiding is needed.

  retry<N extends number>(policy: N & ValidateRetryLimit<N>): ExecutionBuilderSurface<E, true>
  retry<N extends number>(
    policy: RetryPolicy & { limit: N & ValidateRetryLimit<N> }
  ): AsyncExecutionBuilderSurface<E, true>
  retry(policy: RetryOptions): ExecutionBuilderSurface<E, true> {
    return new RunBuilder({
      ...this.config,
      retry: retryOptions(policy),
    })
  }

  timeout(ms: number): AsyncExecutionBuilderSurface<E | TimeoutError, HasRetry> {
    return new RunBuilder(this.buildTimeoutConfig(ms))
  }

  signal(
    signal: AbortSignal
  ): SignalBuilderSurface<E | CancellationError, HasRetry, SupportsOrchestration> {
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

  /**
   * Executes an async unit of work.
   *
   * `catch` maps errors that originated inside `try` — thrown directly, or carried out of the retry
   * loop as the last attempt's error once the retry policy gives up. Policy outcomes ({@link
   * TimeoutError}, {@link CancellationError}) and defects ({@link Panic}) never pass through
   * `catch`; they surface typed in the return union (or are thrown, for `Panic`).
   *
   * Without `catch`, unmapped failures are wrapped: {@link RetryExhaustedError} when a retry policy
   * gave up, {@link UnhandledException} otherwise. The original error is available as `cause`.
   */
  run<T>(tryFn: RunTryFn<T, TryCtxFor<HasRetry>>): Promise<T | UnmappedError<HasRetry> | E>
  run<T, C>(options: AsyncRunInput<T, C, TryCtxFor<HasRetry>>): Promise<T | C | E>
  run<T, C>(input: AsyncRunInput<T, C, TryCtxFor<HasRetry>>) {
    return executeRun(this.config, input)
  }

  /**
   * Executes a sync unit of work.
   *
   * Follows the same `catch` contract as {@link RunBuilder.run}: `catch` maps try-originated errors
   * (including retry give-up); policy outcomes and defects never pass through it.
   */
  runSync<T>(tryFn: SyncRunTryFn<T, TryCtxFor<HasRetry>>): T | UnmappedError<HasRetry> | E
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
