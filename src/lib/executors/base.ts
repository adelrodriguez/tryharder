import type { Panic, RetryExhaustedError, UnhandledException } from "../errors"
import type { BuilderConfig } from "../types/builder"
import type { TryCtx } from "../types/core"
import { CancellationError, TimeoutError } from "../errors"
import {
  calculateRetryDelay,
  checkIsRetryExhausted,
  checkShouldAttemptRetry,
} from "../modifiers/retry"
import { SignalController } from "../modifiers/signal"
import { TimeoutController } from "../modifiers/timeout"
import { executeWithWraps } from "../modifiers/wrap"
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
  | Panic
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
  protected readonly signal: SignalController
  protected readonly timeout: TimeoutController

  protected constructor(config: BuilderConfig, options: BaseExecutionOptions = {}) {
    this.config = config
    this.timeout = new TimeoutController(config.timeout)
    this.signal = new SignalController(
      [...(config.signals ?? []), this.timeout.signal].filter(
        (value): value is AbortSignal => value !== undefined
      )
    )
    this.ctx = BaseExecution.createContext(config, this.signal.signal, options.retryLimit)
  }

  execute(): TResult {
    // Wraps cover the full retry scope; `ctx.retry.attempt` may reflect the final
    // attempt when observed after `next(ctx)` resolves.
    return executeWithWraps(this.config.wraps, this.ctx, () => this.executeCore())
  }

  protected abstract executeCore(): TResult

  [Symbol.dispose](): void {
    using disposer = new DisposableStack()
    disposer.use(this.timeout)
    disposer.use(this.signal)
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

  protected checkDidControlFail(cause?: unknown): CancellationError | TimeoutError | undefined {
    return this.signal.checkDidCancel(cause) ?? this.timeout.checkDidTimeout(cause)
  }

  protected checkBeforeAttempt(): CancellationError | TimeoutError | undefined {
    return this.checkDidControlFail()
  }

  protected resolveSyncSuccess<T>(value: T): T | CancellationError | TimeoutError {
    return this.checkDidControlFail() ?? value
  }

  protected async race<V>(
    promise: PromiseLike<V>,
    cause?: unknown
  ): Promise<V | CancellationError | TimeoutError> {
    const raced = await this.timeout.race(this.signal.race(promise, cause), cause)

    if (raced instanceof TimeoutError) {
      const cancelled = this.signal.checkDidCancel(cause)

      if (cancelled) {
        return cancelled
      }
    }

    return raced
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
