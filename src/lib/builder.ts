import type {
  CancellationError,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "./errors"
import type { BuilderConfig, TaskMap, TimeoutOptions, TimeoutPolicy, WrapFn } from "./types/builder"
import type { RetryOptions } from "./types/retry"
import type {
  AsyncRunCatchFn,
  AsyncRunTryFn,
  RunInput,
  SyncRunCatchFn,
  SyncRunTryFn,
} from "./types/run"
import { normalizeRetryPolicy } from "./retry"
import { executeRun } from "./runner"

type BuiltInRunErrors = UnhandledException
type ConfigRunErrors = RetryExhaustedError | TimeoutError | CancellationError
type AsyncIfRetryConfigured<E extends ConfigRunErrors, T> = RetryExhaustedError extends E
  ? Promise<T>
  : T

function normalizeTimeoutOptions(options: TimeoutOptions): TimeoutPolicy {
  if (typeof options === "number") {
    return { ms: options, scope: "total" }
  }

  return options
}

export class TryBuilder<E extends ConfigRunErrors = never> {
  readonly #config: BuilderConfig

  constructor(config: BuilderConfig = {}) {
    this.#config = config
  }

  retry(policy: RetryOptions): TryBuilder<E | RetryExhaustedError> {
    return new TryBuilder({
      ...this.#config,
      retry: normalizeRetryPolicy(policy),
    })
  }

  timeout(options: TimeoutOptions): TryBuilder<E | TimeoutError> {
    return new TryBuilder({
      ...this.#config,
      timeout: normalizeTimeoutOptions(options),
    })
  }

  signal(signal: AbortSignal): TryBuilder<E | CancellationError> {
    return new TryBuilder({ ...this.#config, signal })
  }

  wrap(fn: WrapFn): TryBuilder<E> {
    return new TryBuilder({
      ...this.#config,
      wraps: [...(this.#config.wraps ?? []), fn],
    })
  }

  run<T>(tryFn: SyncRunTryFn<T>): AsyncIfRetryConfigured<E, T | BuiltInRunErrors | E>
  run<T>(tryFn: AsyncRunTryFn<T>): Promise<T | BuiltInRunErrors | E>
  run<T, C>(options: {
    try: SyncRunTryFn<T>
    catch: SyncRunCatchFn<C>
  }): AsyncIfRetryConfigured<E, T | C | E>
  run<T, C>(
    options:
      | { try: AsyncRunTryFn<T>; catch: SyncRunCatchFn<C> | AsyncRunCatchFn<C> }
      | { try: SyncRunTryFn<T>; catch: AsyncRunCatchFn<C> }
  ): Promise<T | C | E>

  run<T, E>(input: RunInput<T, E>) {
    return executeRun(this.#config, input)
  }

  all(_tasks: TaskMap): never {
    void this.#config
    throw new Error("all is not implemented yet")
  }

  allSettled(_tasks: TaskMap): never {
    void this.#config
    throw new Error("allSettled is not implemented yet")
  }

  flow(_tasks: TaskMap): never {
    void this.#config
    throw new Error("flow is not implemented yet")
  }
}
