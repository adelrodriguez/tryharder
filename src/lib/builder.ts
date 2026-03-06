import type {
  AllOptions,
  AllSettledResult,
  InferredTaskContext,
  TaskRecord,
  TaskResult,
  TaskValidation,
} from "./all"
import type {
  CancellationError,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "./errors"
import type { FlowResult, InferredFlowTaskContext } from "./flow"
import type { GenResult, GenUse } from "./gen"
import type { BuilderConfig, TimeoutOptions, WrapFn } from "./types/builder"
import type {
  DefaultTryCtxProperties,
  SetTryCtxFeature,
  TryCtxFor,
  TryCtxProperties,
} from "./types/core"
import type { RetryOptions } from "./types/retry"
import type { AsyncRunInput, RunTryFn, SyncRunInput, SyncRunTryFn } from "./types/run"
import { executeAll } from "./all"
import { executeAllSettled } from "./all-settled"
import { executeFlow } from "./flow"
import { executeGen } from "./gen"
import { normalizeRetryPolicy } from "./retry"
import { executeRun } from "./run"
import { executeRunSync } from "./run-sync"
import { normalizeTimeoutOptions } from "./timeout"
import { executeWithWraps } from "./wrap"

type ConfigRunErrors = RetryExhaustedError | TimeoutError | CancellationError
type WithRetry<CtxProperties extends TryCtxProperties> = SetTryCtxFeature<CtxProperties, "retry">

function appendWrap(config: BuilderConfig, fn: WrapFn): BuilderConfig {
  return {
    ...config,
    wraps: [...(config.wraps ?? []), fn],
  }
}

function appendSignal(config: BuilderConfig, signal: AbortSignal): BuilderConfig {
  return {
    ...config,
    signals: [...(config.signals ?? []), signal],
  }
}

function addRetry(config: BuilderConfig, policy: RetryOptions): BuilderConfig {
  return {
    ...config,
    retry: normalizeRetryPolicy(policy),
  }
}

function addTimeout(config: BuilderConfig, options: TimeoutOptions): BuilderConfig {
  return {
    ...config,
    timeout: normalizeTimeoutOptions(options),
  }
}

export class WrappedRunBuilder<
  E extends ConfigRunErrors = never,
  CtxProperties extends TryCtxProperties = DefaultTryCtxProperties,
> {
  readonly #config: BuilderConfig

  constructor(config: BuilderConfig) {
    this.#config = config
  }

  wrap(fn: WrapFn): WrappedRunBuilder<E, CtxProperties> {
    return new WrappedRunBuilder(appendWrap(this.#config, fn))
  }

  retry(
    policy: RetryOptions
  ): RunBuilder<E | RetryExhaustedError, false, WithRetry<CtxProperties>> {
    return new RunBuilder(addRetry(this.#config, policy), false)
  }

  timeout(options: TimeoutOptions): RunBuilder<E | TimeoutError, false, CtxProperties> {
    return new RunBuilder(addTimeout(this.#config, options), false)
  }

  signal(signal: AbortSignal): RunBuilder<E | CancellationError, false, CtxProperties> {
    return new RunBuilder(appendSignal(this.#config, signal), false)
  }

  run<T>(tryFn: RunTryFn<T, TryCtxFor<CtxProperties>>): Promise<T | UnhandledException | E>
  run<T, C>(options: AsyncRunInput<T, C, TryCtxFor<CtxProperties>>): Promise<T | C | E>
  run<T, C>(input: AsyncRunInput<T, C, TryCtxFor<CtxProperties>>) {
    return executeRun(this.#config, input)
  }

  runSync<T>(tryFn: SyncRunTryFn<T, TryCtxFor<CtxProperties>>): T | UnhandledException | E
  runSync<T, C>(options: SyncRunInput<T, C, TryCtxFor<CtxProperties>>): T | C | E
  runSync<T, C>(input: SyncRunInput<T, C, TryCtxFor<CtxProperties>>) {
    return executeRunSync(this.#config, input)
  }

  all<T extends TaskRecord, C = never>(
    tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>,
    options?: AllOptions<T, C>
  ): Promise<{ [K in keyof T]: TaskResult<T[K]> } | C> {
    const allOptions = options

    if (allOptions) {
      return executeAll(this.#config, tasks, allOptions)
    }

    return executeAll(this.#config, tasks)
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

  gen<TYield, TReturn>(factory: (useFn: GenUse) => Generator<TYield, TReturn, unknown>) {
    return executeWithWraps(
      this.#config.wraps,
      { retry: { attempt: 1, limit: 1 }, signal: undefined },
      () => executeGen(factory)
    ) as GenResult<TYield, TReturn>
  }
}

export class RunBuilder<
  E extends ConfigRunErrors = never,
  CanSync extends boolean = true,
  CtxProperties extends TryCtxProperties = DefaultTryCtxProperties,
> {
  readonly #config: BuilderConfig
  readonly #canSync: CanSync

  constructor(config: BuilderConfig = {}, canSync = true as CanSync) {
    this.#config = config
    this.#canSync = canSync
  }

  retry(
    policy: RetryOptions
  ): RunBuilder<E | RetryExhaustedError, false, WithRetry<CtxProperties>> {
    return new RunBuilder(addRetry(this.#config, policy), false)
  }

  timeout(options: TimeoutOptions): RunBuilder<E | TimeoutError, false, CtxProperties> {
    return new RunBuilder(addTimeout(this.#config, options), false)
  }

  signal(signal: AbortSignal): RunBuilder<E | CancellationError, false, CtxProperties> {
    return new RunBuilder(appendSignal(this.#config, signal), false)
  }

  wrap(this: RunBuilder<E, true, CtxProperties>, fn: WrapFn): WrappedRunBuilder<E, CtxProperties>
  wrap(this: RunBuilder<E, false, CtxProperties>, fn: WrapFn): RunBuilder<E, false, CtxProperties>
  wrap(fn: WrapFn): WrappedRunBuilder<E, CtxProperties> | RunBuilder<E, false, CtxProperties> {
    const config = appendWrap(this.#config, fn)

    if (this.#canSync) {
      return new WrappedRunBuilder(config)
    }

    return new RunBuilder(config, false)
  }

  run<T>(tryFn: RunTryFn<T, TryCtxFor<CtxProperties>>): Promise<T | UnhandledException | E>
  run<T, C>(options: AsyncRunInput<T, C, TryCtxFor<CtxProperties>>): Promise<T | C | E>
  run<T, C>(input: AsyncRunInput<T, C, TryCtxFor<CtxProperties>>) {
    return executeRun(this.#config, input)
  }

  all<T extends TaskRecord, C = never>(
    tasks: T & TaskValidation<NoInfer<T>> & ThisType<InferredTaskContext<T>>,
    options?: AllOptions<T, C>
  ): Promise<{ [K in keyof T]: TaskResult<T[K]> } | C> {
    const allOptions = options

    if (allOptions) {
      return executeAll(this.#config, tasks, allOptions)
    }

    return executeAll(this.#config, tasks)
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

export function createWrappedBuilder(fn: WrapFn): WrappedRunBuilder {
  return new WrappedRunBuilder({ wraps: [fn] })
}
