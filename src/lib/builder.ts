import type {
  CancellationError,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "./errors"
import type { BuilderConfig, TaskMap, TimeoutOptions, TimeoutPolicy, WrapFn } from "./types/builder"
import type {
  DefaultTryCtxFeatures,
  SetTryCtxFeature,
  TryCtxFeatures,
  TryCtxFor,
} from "./types/core"
import type { RetryOptions } from "./types/retry"
import type {
  AsyncRunInput,
  AsyncRunTryFn,
  RunOptions,
  SyncRunInput,
  SyncRunTryFn,
} from "./types/run"
import { Panic } from "./errors"
import { normalizeRetryPolicy } from "./retry"
import { executeRunAsync, executeRunSync } from "./runner"

type ConfigRunErrors = RetryExhaustedError | TimeoutError | CancellationError
type WithRetry<CtxFeatures extends TryCtxFeatures> = SetTryCtxFeature<CtxFeatures, "retry">

function normalizeTimeoutOptions(options: TimeoutOptions): TimeoutPolicy {
  if (typeof options === "number") {
    return { ms: options, scope: "total" }
  }

  return options
}

export class TryBuilder<
  E extends ConfigRunErrors = never,
  CanRunSync extends boolean = true,
  CtxFeatures extends TryCtxFeatures = DefaultTryCtxFeatures,
> {
  readonly #config: BuilderConfig

  constructor(config: BuilderConfig = {}) {
    this.#config = config
  }

  retry<P extends RetryOptions>(
    policy: P
  ): TryBuilder<E | RetryExhaustedError, P extends number ? true : false, WithRetry<CtxFeatures>>
  retry(
    policy: RetryOptions
  ): TryBuilder<E | RetryExhaustedError, boolean, WithRetry<CtxFeatures>> {
    return new TryBuilder({
      ...this.#config,
      retry: normalizeRetryPolicy(policy),
    })
  }

  timeout(options: TimeoutOptions): TryBuilder<E | TimeoutError, CanRunSync, CtxFeatures> {
    return new TryBuilder({
      ...this.#config,
      timeout: normalizeTimeoutOptions(options),
    })
  }

  signal(signal: AbortSignal): TryBuilder<E | CancellationError, CanRunSync, CtxFeatures> {
    return new TryBuilder({
      ...this.#config,
      signals: [...(this.#config.signals ?? []), signal],
    })
  }

  wrap(fn: WrapFn): TryBuilder<E, CanRunSync, CtxFeatures> {
    return new TryBuilder({
      ...this.#config,
      wraps: [...(this.#config.wraps ?? []), fn],
    })
  }

  run<T>(
    tryFn: CanRunSync extends true ? SyncRunTryFn<T, TryCtxFor<CtxFeatures>> : never
  ): T | UnhandledException | E
  run<T, C>(
    options: CanRunSync extends true ? RunOptions<T, C, TryCtxFor<CtxFeatures>> : never
  ): T | C | E
  run<T, C>(input: SyncRunInput<T, C, TryCtxFor<CtxFeatures>>) {
    return executeRunSync(this.#config, input)
  }

  runAsync<T>(
    tryFn: SyncRunTryFn<T, TryCtxFor<CtxFeatures>> | AsyncRunTryFn<T, TryCtxFor<CtxFeatures>>
  ): Promise<T | UnhandledException | E>
  runAsync<T, C>(options: AsyncRunInput<T, C, TryCtxFor<CtxFeatures>>): Promise<T | C | E>
  runAsync<T, C>(input: AsyncRunInput<T, C, TryCtxFor<CtxFeatures>>) {
    return executeRunAsync(this.#config, input)
  }

  all(_tasks: TaskMap): never {
    void this.#config
    throw new Panic({ message: "all is not implemented yet" })
  }

  allSettled(_tasks: TaskMap): never {
    void this.#config
    throw new Panic({ message: "allSettled is not implemented yet" })
  }

  flow(_tasks: TaskMap): never {
    void this.#config
    throw new Panic({ message: "flow is not implemented yet" })
  }
}
