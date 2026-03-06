import type { ResultProxy, TaskRecord } from "./types/all"
import type { BuilderConfig } from "./types/builder"
import type { TryCtx } from "./types/core"
import type { FlowResult, FlowTaskContext, InferredFlowTaskContext } from "./types/flow"
import { CancellationError, RetryExhaustedError, TimeoutError } from "./errors"
import { calculateRetryDelay, checkIsRetryExhausted, checkShouldAttemptRetry } from "./retry"
import { SignalController } from "./signal"
import { TimeoutController } from "./timeout"
import { checkIsControlError, sleep } from "./utils"
import { executeWithWraps } from "./wrap"

class FlowExitSignal extends Error {
  readonly value: unknown

  constructor(value: unknown) {
    super("Flow exited")
    this.name = "FlowExitSignal"
    this.value = value
  }
}

function checkIsFlowExitSignal(value: unknown): value is FlowExitSignal {
  return value instanceof FlowExitSignal
}

class FlowExecution<T extends TaskRecord> {
  readonly #tasks: T
  readonly #taskNames: Array<keyof T & string>
  readonly #results = new Map<keyof T, unknown>()
  readonly #errors = new Map<keyof T, unknown>()
  readonly #resolvers = new Map<
    keyof T,
    Array<[(value: unknown) => void, (reason?: unknown) => void]>
  >()
  readonly #signal: AbortSignal
  readonly #internalController = new AbortController()
  readonly #disposer = new AsyncDisposableStack()

  constructor(signal: AbortSignal | undefined, tasks: T) {
    this.#tasks = tasks
    this.#taskNames = Object.keys(tasks) as Array<keyof T & string>

    this.#signal = signal
      ? AbortSignal.any([signal, this.#internalController.signal])
      : this.#internalController.signal
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.#disposer.disposeAsync()
  }

  async execute(): Promise<FlowResult<T>> {
    const promises = this.#taskNames.map(async (name) => this.#runTask(name))

    try {
      await Promise.all(promises)
      throw new Error("Flow completed without exit")
    } catch (error) {
      if (checkIsFlowExitSignal(error)) {
        return error.value as FlowResult<T>
      }

      throw error
    }
  }

  #waitForResult(taskName: keyof T, requesterTaskName?: keyof T): Promise<unknown> {
    if (requesterTaskName === taskName) {
      return Promise.reject(new Error(`Task "${String(taskName)}" cannot await its own result`))
    }

    if (!Object.hasOwn(this.#tasks, taskName)) {
      return Promise.reject(new Error(`Unknown task "${String(taskName)}"`))
    }

    if (this.#results.has(taskName)) {
      return Promise.resolve(this.#results.get(taskName))
    }

    if (this.#errors.has(taskName)) {
      const resultError = this.#errors.get(taskName)

      if (checkIsFlowExitSignal(resultError)) {
        return Promise.reject(resultError)
      }

      if (resultError instanceof Error) {
        return Promise.reject(resultError)
      }

      return Promise.reject(new Error("Referenced task failed", { cause: resultError }))
    }

    return new Promise((resolve, reject) => {
      if (!this.#resolvers.has(taskName)) {
        this.#resolvers.set(taskName, [])
      }

      const queue = this.#resolvers.get(taskName)

      if (queue) {
        queue.push([resolve, reject])
      }
    })
  }

  #handleResult(taskName: keyof T, value: unknown): void {
    this.#results.set(taskName, value)

    const fulfilled = this.#resolvers.get(taskName)

    if (fulfilled) {
      for (const [resolve] of fulfilled) {
        resolve(value)
      }
    }
  }

  #handleError(taskName: keyof T, error: unknown): void {
    this.#errors.set(taskName, error)

    const rejected = this.#resolvers.get(taskName)

    if (rejected) {
      for (const [, reject] of rejected) {
        reject(error)
      }
    }
  }

  async #runTask(taskName: keyof T): Promise<void> {
    try {
      const taskFn = this.#tasks[taskName]

      if (typeof taskFn !== "function") {
        throw new Error(`Task "${String(taskName)}" is not a function`)
      }

      const resultProxy = new Proxy({} as ResultProxy<T>, {
        get: (_, referencedTaskName: string) =>
          this.#waitForResult(referencedTaskName as keyof T, taskName),
      })

      const context: FlowTaskContext<T> = {
        $disposer: this.#disposer,
        $exit: (value) => {
          throw new FlowExitSignal(value)
        },
        $result: resultProxy,
        $signal: this.#signal,
      }

      const result = await (taskFn as (this: FlowTaskContext<T>) => unknown).call(context)
      this.#handleResult(taskName, result)
    } catch (error) {
      this.#handleError(taskName, error)

      if (!this.#internalController.signal.aborted) {
        this.#internalController.abort(error)
      }

      throw error
    }
  }
}

export async function executeFlow<T extends TaskRecord>(
  config: BuilderConfig,
  tasks: T & ThisType<InferredFlowTaskContext<T>>
): Promise<FlowResult<T>> {
  using timeout = new TimeoutController(config.timeout)
  using signal = new SignalController(
    [...(config.signals ?? []), timeout.signal].filter(
      (currentSignal): currentSignal is AbortSignal => currentSignal !== undefined
    )
  )
  const executionSignal = signal.signal
  const ctx: TryCtx = {
    retry: {
      attempt: 1,
      limit: config.retry?.limit ?? 1,
    },
    signal: signal.signal,
  }

  const runWithConfig = async (): Promise<FlowResult<T>> => {
    const race = async <V>(
      promise: PromiseLike<V>,
      cause?: unknown
    ): Promise<V | CancellationError | TimeoutError> => {
      const raced = await timeout.race(signal.race(promise, cause), cause)

      if (raced instanceof TimeoutError) {
        const cancelled = signal.checkDidCancel(cause)

        if (cancelled) {
          return cancelled
        }
      }

      return raced
    }

    const executeAttempt = async () => {
      await using execution = new FlowExecution(executionSignal, tasks)
      return await race(execution.execute())
    }

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const controlBeforeAttempt = signal.checkDidCancel() ?? timeout.checkDidTimeout()

      if (controlBeforeAttempt) {
        throw controlBeforeAttempt
      }

      try {
        // oxlint-disable-next-line no-await-in-loop
        const result = await executeAttempt()

        if (result instanceof CancellationError || result instanceof TimeoutError) {
          throw result
        }

        return result
      } catch (error) {
        if (checkIsControlError(error)) {
          throw error
        }

        const controlAfterFailure = signal.checkDidCancel(error) ?? timeout.checkDidTimeout(error)

        if (controlAfterFailure) {
          throw controlAfterFailure
        }

        const shouldRetry = checkShouldAttemptRetry(error, ctx, config)

        if (!shouldRetry) {
          if (checkIsRetryExhausted(ctx.retry.attempt, config)) {
            throw new RetryExhaustedError({ cause: error })
          }

          throw error
        }

        const delay = calculateRetryDelay(ctx.retry.attempt, config)

        if (delay > 0) {
          // oxlint-disable-next-line no-await-in-loop
          const delayed = await race(sleep(delay), error)

          if (delayed instanceof CancellationError || delayed instanceof TimeoutError) {
            throw delayed
          }
        }

        ctx.retry.attempt += 1
      }
    }
  }

  return (await Promise.resolve(
    executeWithWraps(config.wraps, ctx, () => runWithConfig())
  )) as FlowResult<T>
}

export type { FlowExit, FlowResult, FlowTaskContext, InferredFlowTaskContext } from "./types/flow"
