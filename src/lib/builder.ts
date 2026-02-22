import type { UnhandledException } from "./errors"
import type {
  BuilderConfig,
  RetryPolicy,
  RunTryFn,
  RunWithCatchOptions,
  TaskMap,
  TimeoutOptions,
  WrapFn,
} from "./types"
import { normalizeRetryPolicy } from "./retry"
import { executeRun } from "./runner"

function normalizeTimeoutOptions(options: number | TimeoutOptions): TimeoutOptions {
  if (typeof options === "number") {
    return { ms: options, scope: "total" }
  }

  return options
}

export class TryBuilder {
  readonly #config: BuilderConfig

  constructor(config: BuilderConfig = {}) {
    this.#config = config
  }

  retry(policy: number | RetryPolicy): TryBuilder {
    return new TryBuilder({
      ...this.#config,
      retry: normalizeRetryPolicy(policy),
    })
  }

  timeout(options: number | TimeoutOptions): TryBuilder {
    return new TryBuilder({
      ...this.#config,
      timeout: normalizeTimeoutOptions(options),
    })
  }

  signal(signal: AbortSignal): TryBuilder {
    return new TryBuilder({ ...this.#config, signal })
  }

  wrap(fn: WrapFn): TryBuilder {
    return new TryBuilder({
      ...this.#config,
      wraps: [...(this.#config.wraps ?? []), fn],
    })
  }

  run<T>(tryFn: RunTryFn<T>): T | UnhandledException
  run<T, E>(options: RunWithCatchOptions<T, E>): T | E

  run<T, E>(input: RunTryFn<T> | RunWithCatchOptions<T, E>) {
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
