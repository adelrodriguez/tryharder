import type { BuilderConfig, WrapCtx } from "../builder"
import type { TryCtx } from "./shared"
import { defineDisposeAlias } from "../../shims/disposer"
import {
  CancellationError,
  ControlError,
  Panic,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "../errors"
import { calculateRetryDelay, checkShouldAttemptRetry } from "../modifiers/retry"
import { SignalController } from "../modifiers/signal"
import { TimeoutController } from "../modifiers/timeout"
import { sleep } from "../utils"

interface BaseExecutionOptions {
  retryLimit?: number
}

export type RetryDecision = {
  delay: number
  shouldAttemptRetry: boolean
}

export type RunnerError =
  | CancellationError
  | RetryExhaustedError
  | TimeoutError
  | UnhandledException

export class RetryDirective {
  readonly decision: RetryDecision

  constructor(decision: RetryDecision) {
    this.decision = decision
  }
}

export abstract class BaseExecution<TResult = unknown> implements Disposable {
  protected readonly config: BuilderConfig
  protected readonly ctx: TryCtx
  protected readonly executionSignal: AbortSignal | undefined
  #wrapCtxCache: WrapCtx | undefined
  readonly #signalController: SignalController | undefined
  readonly #timeoutController: TimeoutController | undefined
  declare [Symbol.dispose]: () => void

  protected constructor(config: BuilderConfig, options: BaseExecutionOptions = {}) {
    this.config = config
    this.#timeoutController = BaseExecution.createTimeoutController(config.timeout)
    this.#signalController = BaseExecution.createSignalController(
      config.signals,
      this.#timeoutController?.signal
    )
    this.executionSignal = this.#signalController?.signal
    this.ctx = BaseExecution.createContext(config, this.executionSignal, options.retryLimit)
  }

  execute(): TResult {
    // Wraps cover the full retry scope; `ctx.retry.attempt` may reflect the final
    // attempt when observed after `next()` resolves.
    const wraps = this.config.wraps

    if (!wraps || wraps.length === 0) {
      return this.executeCore()
    }

    let next = (): unknown => this.executeCore()

    for (const wrap of wraps.toReversed()) {
      const previous = next
      next = () => wrap(this.#wrapCtx, previous)
    }

    return next() as TResult
  }

  protected abstract executeCore(): TResult

  dispose(): void {
    // Tear down in LIFO order (the signal controller is created after the timeout
    // controller); the try/finally guarantees a throw from one cannot skip the other.
    try {
      this.#signalController?.dispose()
    } finally {
      this.#timeoutController?.dispose()
    }
  }

  protected static createContext(
    config: BuilderConfig,
    signal: AbortSignal | undefined,
    retryLimit?: number
  ): TryCtx {
    return {
      retry: {
        attempt: 1,
        limit: retryLimit ?? config.retry?.limit ?? 1,
      },
      signal,
    }
  }

  protected static createTimeoutController(
    timeoutMs: number | undefined
  ): TimeoutController | undefined {
    return timeoutMs === undefined ? undefined : new TimeoutController(timeoutMs)
  }

  protected static createSignalController(
    signals: readonly AbortSignal[] | undefined,
    timeoutSignal: AbortSignal | undefined
  ): SignalController | undefined {
    const composedSignals = [...(signals ?? []), timeoutSignal].filter(
      (value): value is AbortSignal => value !== undefined
    )

    return composedSignals.length > 0 ? new SignalController(composedSignals) : undefined
  }

  protected static createWrapContext(ctx: TryCtx): WrapCtx {
    // `ctx.retry.attempt` advances across retries, so the retry view must stay live
    // while still reporting read-only data descriptors; a Proxy is the only way to
    // do both. `ctx.signal` is set once at construction, so a frozen plain object
    // suffices for the rest.
    const retry = new Proxy(ctx.retry, {
      defineProperty: () => false,
      deleteProperty: () => false,
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property)

        if (!descriptor) {
          return descriptor
        }

        return {
          ...descriptor,
          writable: false,
        }
      },
      set: () => false,
    })

    return Object.freeze({ retry, signal: ctx.signal })
  }

  protected checkDidCancel(cause?: unknown): CancellationError | undefined {
    return this.#signalController?.checkDidCancel(cause)
  }

  protected raceWithCancellation<V>(
    promise: PromiseLike<V>,
    cause?: unknown
  ): PromiseLike<V | CancellationError> {
    return this.#signalController ? this.#signalController.race(promise, cause) : promise
  }

  /**
   * Observes current control state: cancellation is consulted before timeout, making this the
   * single statement of the cancellation-beats-timeout ordering. `cause` threads the underlying
   * error into whichever control error is created.
   */
  protected checkDidControlFail(cause?: unknown): CancellationError | TimeoutError | undefined {
    return this.checkDidCancel(cause) ?? this.#timeoutController?.checkDidTimeout(cause)
  }

  /**
   * Single owner of the outcome-priority rule: cancellation beats timeout beats the candidate
   * outcome. Callers invoke this at every boundary where control state may have changed since the
   * candidate was produced; `cause` threads the underlying error into whichever control error is
   * reported. A `TimeoutError` candidate already won its race, so it is preserved as-is unless a
   * near-simultaneous cancellation displaces it.
   */
  protected resolveOutcome<V>(candidate: V, cause?: unknown): V | CancellationError | TimeoutError {
    if (candidate instanceof TimeoutError) {
      return this.checkDidCancel(cause) ?? candidate
    }

    return this.checkDidControlFail(cause) ?? candidate
  }

  protected race<V>(
    promise: PromiseLike<V>,
    cause?: unknown
  ): PromiseLike<V | CancellationError | TimeoutError> {
    const timeoutController = this.#timeoutController

    if (!timeoutController) {
      return this.raceWithCancellation(promise, cause)
    }

    // Nest cancellation inside the timeout race so cancellation takes priority
    // when both fire: if cancellation wins, the inner promise already resolves
    // with a CancellationError; if timeout wins, the outcome is still provisional,
    // so route it through resolveOutcome for a near-simultaneous cancel to displace
    // it. A settled value is final: the race already arbitrated it.
    return Promise.resolve(
      timeoutController.race(this.raceWithCancellation(promise, cause), cause)
    ).then((raced) => (raced instanceof TimeoutError ? this.resolveOutcome(raced, cause) : raced))
  }

  protected async waitForRetryDelay(
    delay: number
  ): Promise<CancellationError | TimeoutError | undefined> {
    if (delay <= 0) {
      return undefined
    }

    const sleepResult = await this.race(sleep(delay))

    if (sleepResult instanceof CancellationError || sleepResult instanceof TimeoutError) {
      return sleepResult
    }

    return undefined
  }

  protected shouldAttemptRetry(error: unknown): boolean {
    return checkShouldAttemptRetry(error, this.ctx, this.config)
  }

  protected retryDelayForCurrentAttempt(): number {
    return calculateRetryDelay(this.ctx.retry.attempt, this.config)
  }

  protected buildRetryDecision(error: unknown): RetryDecision {
    const shouldAttemptRetry = this.shouldAttemptRetry(error)

    return {
      delay: shouldAttemptRetry ? this.retryDelayForCurrentAttempt() : 0,
      shouldAttemptRetry,
    }
  }

  /**
   * Shared prefix of attempt-failure resolution: rethrows defects, passes control errors through,
   * and turns retryable failures into a {@link RetryDirective}. Returns `undefined` when the failure
   * should continue into catch mapping (or unmapped wrapping).
   */
  protected resolveControlOrRetry(error: unknown): RunnerError | RetryDirective | undefined {
    if (error instanceof Panic) {
      throw error
    }

    if (error instanceof ControlError) {
      return error
    }

    const controlError = this.checkDidControlFail(error)

    if (controlError) {
      return controlError
    }

    const retryDecision = this.buildRetryDecision(error)

    if (retryDecision.shouldAttemptRetry) {
      return new RetryDirective(retryDecision)
    }

    return undefined
  }

  /**
   * Shared tail of attempt-failure resolution when no catch handler exists. With retry configured,
   * any give-up (limit exhausted or shouldRetry declining) is reported uniformly as
   * {@link RetryExhaustedError} carrying the last attempt's error; otherwise the failure is wrapped
   * in {@link UnhandledException}.
   */
  protected resolveUnmappedFailure(error: unknown): RunnerError {
    // Even without a catch handler, cancellation/timeout may have won since
    // the original failure was first observed, so the wrapped error is only a
    // candidate outcome.
    const wrapped = this.config.retry
      ? new RetryExhaustedError(undefined, { cause: error })
      : new UnhandledException(undefined, { cause: error })

    return this.resolveOutcome(wrapped, error)
  }

  get #wrapCtx(): WrapCtx {
    this.#wrapCtxCache ??= BaseExecution.createWrapContext(this.ctx)
    return this.#wrapCtxCache
  }
}
defineDisposeAlias(BaseExecution.prototype)
