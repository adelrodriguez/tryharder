import type { ResultProxy, TaskRecord } from "../types/all"
import type { BuilderConfig } from "../types/builder"
import type { FlowResult, FlowTaskContext, InferredFlowTaskContext } from "../types/flow"
import { Panic, RetryExhaustedError, UnhandledException } from "../errors"
import { checkIsControlError, invariant } from "../utils"
import { BaseExecution } from "./base"

class FlowExitSignal extends Error {
  readonly value: unknown

  constructor(value: unknown) {
    super("Flow exited")
    this.name = "FlowExitSignal"
    this.value = value
  }
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
      throw new Panic("FLOW_NO_EXIT")
    } catch (error) {
      if (error instanceof FlowExitSignal) {
        return error.value as FlowResult<T>
      }

      throw error
    }
  }

  #waitForResult(taskName: keyof T, requesterTaskName?: keyof T): Promise<unknown> {
    if (requesterTaskName === taskName) {
      return Promise.reject(
        new Panic("TASK_SELF_REFERENCE", {
          message: `Task "${String(taskName)}" cannot await its own result`,
        })
      )
    }

    if (!Object.hasOwn(this.#tasks, taskName)) {
      return Promise.reject(
        new Panic("TASK_UNKNOWN_REFERENCE", {
          message: `Unknown task "${String(taskName)}"`,
        })
      )
    }

    if (this.#results.has(taskName)) {
      return Promise.resolve(this.#results.get(taskName))
    }

    if (this.#errors.has(taskName)) {
      const resultError = this.#errors.get(taskName)

      if (resultError instanceof FlowExitSignal) {
        return Promise.reject(resultError)
      }

      return Promise.reject(
        resultError instanceof Error
          ? resultError
          : new UnhandledException(undefined, { cause: resultError })
      )
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

      this.#resolvers.delete(taskName)
    }
  }

  #handleError(taskName: keyof T, error: unknown): void {
    this.#errors.set(taskName, error)

    const rejected = this.#resolvers.get(taskName)

    if (rejected) {
      for (const [, reject] of rejected) {
        reject(error)
      }

      this.#resolvers.delete(taskName)
    }
  }

  async #runTask(taskName: keyof T): Promise<void> {
    try {
      const taskFn = this.#tasks[taskName]

      invariant(
        typeof taskFn === "function",
        new Panic("TASK_INVALID_HANDLER", {
          message: `Task "${String(taskName)}" is not a function`,
        })
      )

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

class FlowRunnerExecution<T extends TaskRecord> extends BaseExecution<Promise<FlowResult<T>>> {
  readonly #tasks: T

  constructor(config: BuilderConfig, tasks: T) {
    super(config)
    this.#tasks = tasks
  }

  protected override async executeCore(): Promise<FlowResult<T>> {
    let currentAttempt = 1

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    while (true) {
      const controlBeforeAttempt = this.checkBeforeAttempt()

      if (controlBeforeAttempt) {
        throw controlBeforeAttempt
      }

      this.ctx.retry.attempt = currentAttempt

      try {
        // oxlint-disable-next-line no-await-in-loop
        const result = await this.#executeAttempt()
        const controlAfterAttempt = this.checkDidControlFail()

        if (controlAfterAttempt) {
          throw controlAfterAttempt
        }

        return result
      } catch (error) {
        if (checkIsControlError(error)) {
          throw error
        }

        const controlAfterFailure = this.checkDidControlFail(error)

        if (controlAfterFailure) {
          throw controlAfterFailure
        }

        const retryDecision = this.buildRetryDecision(error)

        if (!retryDecision.shouldAttemptRetry) {
          if (retryDecision.isRetryExhausted) {
            throw new RetryExhaustedError(undefined, { cause: error })
          }

          throw error
        }

        // oxlint-disable-next-line no-await-in-loop
        const delayControlResult = await this.waitForRetryDelay(retryDecision.delay)

        if (delayControlResult) {
          throw delayControlResult
        }

        currentAttempt += 1
      }
    }
  }

  async #executeAttempt(): Promise<FlowResult<T>> {
    await using execution = new FlowExecution(this.signal.signal, this.#tasks)
    return (await this.race(execution.execute())) as FlowResult<T>
  }
}

export async function executeFlow<T extends TaskRecord>(
  config: BuilderConfig,
  tasks: T & ThisType<InferredFlowTaskContext<T>>
): Promise<FlowResult<T>> {
  using execution = new FlowRunnerExecution(config, tasks)
  return await execution.execute()
}

export type { FlowExit, FlowResult, FlowTaskContext, InferredFlowTaskContext } from "../types/flow"
