import type {
  CancellationError,
  PanicMessages,
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
import type { GenResult, GenUse } from "./executors/gen"
import type { BuilderConfig, TimeoutOptions, WrapFn } from "./types/builder"
import type {
  BuilderState,
  DefaultBuilderState,
  DefaultTryCtxProperties,
  SetBuilderState,
  SetTryCtxFeature,
  TryCtxFor,
  TryCtxProperties,
} from "./types/core"
import type { RetryOptions } from "./types/retry"
import type { AsyncRunInput, RunTryFn } from "./types/run"
import { Panic } from "./errors"
import { executeAll } from "./executors/all"
import { executeAllSettled } from "./executors/all-settled"
import { executeFlow } from "./executors/flow"
import { executeGen } from "./executors/gen"
import { executeRun } from "./executors/run"
import { executeRunSync, type SyncRunInput, type SyncRunTryFn } from "./executors/run-sync"
import { createRetryPolicy } from "./modifiers/retry"
import { normalizeTimeoutOptions } from "./modifiers/timeout"
import { executeWithWraps } from "./modifiers/wrap"
import { invariant } from "./utils"

type ConfigRunErrors = RetryExhaustedError | TimeoutError | CancellationError
type WithRetry<CtxProperties extends TryCtxProperties> = SetTryCtxFeature<CtxProperties, "retry">
type DisableSync<State extends BuilderState> = SetBuilderState<State, "canSync", false>
type DisableWrap<State extends BuilderState> = SetBuilderState<State, "canWrap", false>
type MarkWrapped<State extends BuilderState> = SetBuilderState<State, "isWrapped", true>
type AsyncOnlyState<State extends BuilderState> = DisableWrap<DisableSync<State>>

const defaultBuilderState: DefaultBuilderState = {
  canSync: true,
  canWrap: true,
  isWrapped: false,
}

export class RunBuilder<
  E extends ConfigRunErrors = never,
  CtxProperties extends TryCtxProperties = DefaultTryCtxProperties,
  State extends BuilderState = DefaultBuilderState,
> {
  readonly #config: BuilderConfig
  readonly #state: BuilderState

  constructor(config: BuilderConfig = {}, state: BuilderState = defaultBuilderState) {
    this.#config = config
    this.#state = state
  }

  retry(
    policy: RetryOptions
  ): RunBuilder<E | RetryExhaustedError, WithRetry<CtxProperties>, AsyncOnlyState<State>> {
    return new RunBuilder(
      {
        ...this.#config,
        retry: createRetryPolicy(policy),
      },
      {
        ...this.#state,
        canSync: false,
        canWrap: false,
      }
    )
  }

  timeout(
    options: TimeoutOptions
  ): RunBuilder<E | TimeoutError, CtxProperties, AsyncOnlyState<State>> {
    return new RunBuilder(
      {
        ...this.#config,
        timeout: normalizeTimeoutOptions(options),
      },
      {
        ...this.#state,
        canSync: false,
        canWrap: false,
      }
    )
  }

  signal(
    signal: AbortSignal
  ): RunBuilder<E | CancellationError, CtxProperties, AsyncOnlyState<State>> {
    return new RunBuilder(
      {
        ...this.#config,
        signals: [...(this.#config.signals ?? []), signal],
      },
      {
        ...this.#state,
        canSync: false,
        canWrap: false,
      }
    )
  }

  wrap(
    fn: State["canWrap"] extends true ? WrapFn : PanicMessages["WRAP_UNAVAILABLE"]
  ): RunBuilder<E, CtxProperties, MarkWrapped<State>>
  wrap(
    fn: WrapFn | PanicMessages["WRAP_UNAVAILABLE"]
  ): RunBuilder<E, CtxProperties, MarkWrapped<State>> {
    invariant(this.#state.canWrap, new Panic("WRAP_UNAVAILABLE"))
    invariant(typeof fn === "function", new Panic("WRAP_INVALID_HANDLER"))

    return new RunBuilder(
      {
        ...this.#config,
        wraps: [...(this.#config.wraps ?? []), fn],
      },
      {
        ...this.#state,
        isWrapped: true,
      }
    )
  }

  run<T>(tryFn: RunTryFn<T, TryCtxFor<CtxProperties>>): Promise<T | UnhandledException | E>
  run<T, C>(options: AsyncRunInput<T, C, TryCtxFor<CtxProperties>>): Promise<T | C | E>
  run<T, C>(input: AsyncRunInput<T, C, TryCtxFor<CtxProperties>>) {
    return executeRun(this.#config, input)
  }

  runSync<T>(
    tryFn: State["canSync"] extends true
      ? SyncRunTryFn<T, TryCtxFor<CtxProperties>>
      : PanicMessages["RUN_SYNC_UNAVAILABLE"]
  ): T | UnhandledException | E
  runSync<T, C>(
    input: State["canSync"] extends true
      ? SyncRunInput<T, C, TryCtxFor<CtxProperties>>
      : PanicMessages["RUN_SYNC_UNAVAILABLE"]
  ): T | C | E
  runSync<T, C>(
    input: SyncRunInput<T, C, TryCtxFor<CtxProperties>> | PanicMessages["RUN_SYNC_UNAVAILABLE"]
  ) {
    invariant(this.#state.canSync, new Panic("RUN_SYNC_UNAVAILABLE"))
    invariant(typeof input !== "string", new Panic("RUN_SYNC_INVALID_INPUT"))

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

  gen<TYield, TReturn>(
    factory: State["canSync"] extends true
      ? (useFn: GenUse) => Generator<TYield, TReturn, unknown>
      : PanicMessages["GEN_UNAVAILABLE"]
  ) {
    invariant(this.#state.canSync, new Panic("GEN_UNAVAILABLE"))
    invariant(typeof factory === "function", new Panic("GEN_INVALID_FACTORY"))

    return executeWithWraps(
      this.#config.wraps,
      { retry: { attempt: 1, limit: 1 }, signal: undefined },
      () => executeGen(factory)
    ) as GenResult<TYield, TReturn>
  }
}
