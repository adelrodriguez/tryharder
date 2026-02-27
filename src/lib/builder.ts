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
import type { BuilderConfig, TimeoutOptions, WrapFn } from "./types/builder"
import type {
  DefaultTryCtxProperties,
  SetTryCtxFeature,
  TryCtxFor,
  TryCtxProperties,
} from "./types/core"
import type { RetryOptions } from "./types/retry"
import type { AsyncRunInput, RunTryFn, SyncRunInput, SyncRunTryFn } from "./types/run"
import { executeAll, executeAllSettled } from "./all"
import { Panic } from "./errors"
import { normalizeRetryPolicy } from "./retry"
import { executeRun } from "./run"
import { executeRunSync } from "./run-sync"
import { normalizeTimeoutOptions } from "./timeout"

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

function enableSettled(config: BuilderConfig): BuilderConfig {
  return {
    ...config,
    settled: true,
  }
}

export class WrappedRunBuilder<
  E extends ConfigRunErrors = never,
  CtxProperties extends TryCtxProperties = DefaultTryCtxProperties,
  Settled extends boolean = false,
> {
  readonly #config: BuilderConfig

  constructor(config: BuilderConfig) {
    this.#config = config
  }

  wrap(fn: WrapFn): WrappedRunBuilder<E, CtxProperties, Settled> {
    return new WrappedRunBuilder(appendWrap(this.#config, fn))
  }

  retry(
    policy: RetryOptions
  ): RunBuilder<E | RetryExhaustedError, false, WithRetry<CtxProperties>, Settled> {
    return new RunBuilder(addRetry(this.#config, policy), false)
  }

  timeout(options: TimeoutOptions): RunBuilder<E | TimeoutError, false, CtxProperties, Settled> {
    return new RunBuilder(addTimeout(this.#config, options), false)
  }

  signal(signal: AbortSignal): RunBuilder<E | CancellationError, false, CtxProperties, Settled> {
    return new RunBuilder(appendSignal(this.#config, signal), false)
  }

  settled(): WrappedRunBuilder<E, CtxProperties, true> {
    return new WrappedRunBuilder(enableSettled(this.#config))
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
    ...options: Settled extends true ? [] : [options?: AllOptions<T, C>]
  ): Promise<
    Settled extends true ? AllSettledResult<T> : { [K in keyof T]: TaskResult<T[K]> } | C
  > {
    if (this.#config.settled) {
      return executeAllSettled(this.#config, tasks) as Promise<
        Settled extends true ? AllSettledResult<T> : { [K in keyof T]: TaskResult<T[K]> } | C
      >
    }

    const [allOptions] = options

    if (allOptions) {
      return executeAll(this.#config, tasks, allOptions) as Promise<
        Settled extends true ? AllSettledResult<T> : { [K in keyof T]: TaskResult<T[K]> } | C
      >
    }

    return executeAll(this.#config, tasks) as Promise<
      Settled extends true ? AllSettledResult<T> : { [K in keyof T]: TaskResult<T[K]> } | C
    >
  }

  flow(_tasks: TaskRecord): never {
    void this.#config
    throw new Panic({ message: "flow is not implemented yet" })
  }
}

export class RunBuilder<
  E extends ConfigRunErrors = never,
  CanSync extends boolean = true,
  CtxProperties extends TryCtxProperties = DefaultTryCtxProperties,
  Settled extends boolean = false,
> {
  readonly #config: BuilderConfig
  readonly #canSync: CanSync

  constructor(config: BuilderConfig = {}, canSync = true as CanSync) {
    this.#config = config
    this.#canSync = canSync
  }

  retry(
    policy: RetryOptions
  ): RunBuilder<E | RetryExhaustedError, false, WithRetry<CtxProperties>, Settled> {
    return new RunBuilder(addRetry(this.#config, policy), false)
  }

  timeout(options: TimeoutOptions): RunBuilder<E | TimeoutError, false, CtxProperties, Settled> {
    return new RunBuilder(addTimeout(this.#config, options), false)
  }

  signal(signal: AbortSignal): RunBuilder<E | CancellationError, false, CtxProperties, Settled> {
    return new RunBuilder(appendSignal(this.#config, signal), false)
  }

  settled(): RunBuilder<E, CanSync, CtxProperties, true> {
    return new RunBuilder(enableSettled(this.#config), this.#canSync)
  }

  wrap(
    this: RunBuilder<E, true, CtxProperties, Settled>,
    fn: WrapFn
  ): WrappedRunBuilder<E, CtxProperties, Settled>
  wrap(
    this: RunBuilder<E, false, CtxProperties, Settled>,
    fn: WrapFn
  ): RunBuilder<E, false, CtxProperties, Settled>
  wrap(
    fn: WrapFn
  ): WrappedRunBuilder<E, CtxProperties, Settled> | RunBuilder<E, false, CtxProperties, Settled> {
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
    ...options: Settled extends true ? [] : [options?: AllOptions<T, C>]
  ): Promise<
    Settled extends true ? AllSettledResult<T> : { [K in keyof T]: TaskResult<T[K]> } | C
  > {
    if (this.#config.settled) {
      return executeAllSettled(this.#config, tasks) as Promise<
        Settled extends true ? AllSettledResult<T> : { [K in keyof T]: TaskResult<T[K]> } | C
      >
    }

    const [allOptions] = options

    if (allOptions) {
      return executeAll(this.#config, tasks, allOptions) as Promise<
        Settled extends true ? AllSettledResult<T> : { [K in keyof T]: TaskResult<T[K]> } | C
      >
    }

    return executeAll(this.#config, tasks) as Promise<
      Settled extends true ? AllSettledResult<T> : { [K in keyof T]: TaskResult<T[K]> } | C
    >
  }

  flow(_tasks: TaskRecord): never {
    void this.#config
    throw new Panic({ message: "flow is not implemented yet" })
  }
}
