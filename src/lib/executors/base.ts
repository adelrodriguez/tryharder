import type { BuilderConfig, WrapCtx } from "../builder"
import type { RetryExhaustedError, UnhandledException } from "../errors"
import type { TryCtx } from "./shared"
import { CancellationError, TimeoutError } from "../errors"
import {
  calculateRetryDelay,
  checkIsRetryExhausted,
  checkShouldAttemptRetry,
} from "../modifiers/retry"
import { SignalController } from "../modifiers/signal"
import { TimeoutController } from "../modifiers/timeout"
import { sleep } from "../utils"

interface BaseExecutionOptions {
  retryLimit?: number
}

export type RetryDecision = {
  delay: number
  isRetryExhausted: boolean
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

export abstract class BaseExecution<TResult = unknown> {
  protected readonly config: BuilderConfig
  protected readonly ctx: TryCtx
  protected readonly executionSignal: AbortSignal | undefined
  readonly #wrapCtx: WrapCtx
  readonly #signalController: SignalController | undefined
  readonly #timeoutController: TimeoutController | undefined

  protected constructor(config: BuilderConfig, options: BaseExecutionOptions = {}) {
    this.config = config
    this.#timeoutController = BaseExecution.createTimeoutController(config.timeout)
    this.#signalController = BaseExecution.createSignalController(
      config.signals,
      this.#timeoutController?.signal
    )
    this.executionSignal = this.#signalController?.signal
    this.ctx = BaseExecution.createContext(config, this.executionSignal, options.retryLimit)
    this.#wrapCtx = BaseExecution.createWrapContext(this.ctx)
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

  [Symbol.dispose](): void {
    using disposer = new DisposableStack()
    if (this.#timeoutController) {
      disposer.use(this.#timeoutController)
    }

    if (this.#signalController) {
      disposer.use(this.#signalController)
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
    }) as WrapCtx["retry"]

    return new Proxy(ctx, {
      defineProperty: () => false,
      deleteProperty: () => false,
      get(target, property, receiver) {
        if (property === "retry") {
          return retry
        }

        return Reflect.get(target, property, receiver) as unknown
      },
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property)

        if (!descriptor) {
          return descriptor
        }

        if (property === "retry") {
          return {
            ...descriptor,
            value: retry,
            writable: false,
          }
        }

        return {
          ...descriptor,
          writable: false,
        }
      },
      set: () => false,
    }) as WrapCtx
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

  protected checkDidControlFail(cause?: unknown): CancellationError | TimeoutError | undefined {
    return this.checkDidCancel(cause) ?? this.#timeoutController?.checkDidTimeout(cause)
  }

  protected resolveSyncSuccess<T>(value: T): T | CancellationError | TimeoutError {
    return this.checkDidControlFail() ?? value
  }

  protected race<V>(
    promise: PromiseLike<V>,
    cause?: unknown
  ): PromiseLike<V | CancellationError | TimeoutError> {
    const timeoutController = this.#timeoutController

    if (!timeoutController) {
      return this.raceWithCancellation(promise, cause)
    }

    return Promise.resolve(
      timeoutController.race(this.raceWithCancellation(promise, cause), cause)
    ).then((raced) => {
      if (raced instanceof TimeoutError) {
        return this.checkDidCancel(cause) ?? raced
      }

      return raced
    })
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

  protected checkIsRetryExhaustedCurrentAttempt(): boolean {
    return checkIsRetryExhausted(this.ctx.retry.attempt, this.config)
  }

  protected buildRetryDecision(error: unknown): RetryDecision {
    const shouldAttemptRetry = this.shouldAttemptRetry(error)

    return {
      delay: shouldAttemptRetry ? this.retryDelayForCurrentAttempt() : 0,
      isRetryExhausted: this.checkIsRetryExhaustedCurrentAttempt(),
      shouldAttemptRetry,
    }
  }
}
