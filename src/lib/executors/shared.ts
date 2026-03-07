import type { ResultProxy, TaskContext, TaskRecord } from "../types/all"
import type { BuilderConfig } from "../types/builder"
import { Panic, UnhandledException } from "../errors"
import { invariant } from "../utils"
import { BaseExecution } from "./base"

type ResolverPair = [(value: unknown) => void, (reason?: unknown) => void]

export type TaskExecutionMode = "fail-fast" | "settled"

export abstract class OrchestrationExecution<TResult> extends BaseExecution<Promise<TResult>> {
  protected constructor(config: BuilderConfig) {
    const unsupportedPolicies = [
      config.retry === undefined ? undefined : "retry",
      config.timeout === undefined ? undefined : "timeout",
    ].filter((value): value is "retry" | "timeout" => value !== undefined)

    invariant(
      unsupportedPolicies.length === 0,
      new Panic("ORCHESTRATION_UNSUPPORTED_POLICY", {
        message: `Orchestration does not support ${unsupportedPolicies.join(" or ")} policies.`,
      })
    )

    super({
      signals: config.signals,
      wraps: config.wraps,
    })
  }

  protected override async executeCore(): Promise<TResult> {
    // Orchestration executors still share outer wraps/cancellation checks even
    // though their task execution strategies differ.
    const controlBeforeExecution = this.checkDidControlFail()

    if (controlBeforeExecution) {
      throw controlBeforeExecution
    }

    return await this.executeTasks()
  }

  protected abstract executeTasks(): Promise<TResult>
}

export class TaskExecution<T extends TaskRecord> {
  readonly #tasks: T
  readonly #mode: TaskExecutionMode
  readonly #taskNames: Array<keyof T & string>
  readonly #results = new Map<keyof T, unknown>()
  readonly #errors = new Map<keyof T, unknown>()
  readonly #resolvers = new Map<keyof T, ResolverPair[]>()
  readonly #returnValue: Record<string, unknown> = {}
  readonly #internalController = new AbortController()
  readonly #signal: AbortSignal
  readonly #disposer = new AsyncDisposableStack()
  #failedTask: (keyof T & string) | undefined
  #firstRejection: unknown

  constructor(signal: AbortSignal | undefined, tasks: T, mode: TaskExecutionMode) {
    this.#tasks = tasks
    this.#mode = mode
    this.#taskNames = Object.keys(tasks) as Array<keyof T & string>
    this.#signal = signal
      ? AbortSignal.any([signal, this.#internalController.signal])
      : this.#internalController.signal
  }

  get failedTask(): (keyof T & string) | undefined {
    return this.#failedTask
  }

  get signal(): AbortSignal {
    return this.#signal
  }

  get returnValue(): Record<string, unknown> {
    return this.#returnValue
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.#disposer.disposeAsync()
  }

  async execute(): Promise<Record<string, unknown>> {
    const promises = this.#taskNames.map(async (name) => this.#runTask(name))

    if (this.#mode === "settled") {
      await Promise.allSettled(promises)
      return this.#returnValue
    }

    await Promise.allSettled(promises)

    if (this.#firstRejection !== undefined) {
      throw this.#firstRejection
    }

    return this.#returnValue
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

    if (this.#mode === "settled") {
      this.#returnValue[taskName as string] = { status: "fulfilled", value }
    } else {
      this.#returnValue[taskName as string] = value
    }

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
    this.#failedTask ??= taskName as keyof T & string

    if (this.#mode === "settled") {
      this.#returnValue[taskName as string] = { reason: error, status: "rejected" }
    }

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

      const context: TaskContext<T> = {
        $disposer: this.#disposer,
        $result: resultProxy,
        $signal: this.#signal,
      }

      const result = await (taskFn as (this: TaskContext<T>) => unknown).call(context)
      this.#handleResult(taskName, result)
    } catch (error) {
      this.#firstRejection ??= error
      this.#handleError(taskName, error)

      if (this.#mode === "fail-fast") {
        this.#internalController.abort(error)
        throw error
      }
    }
  }
}
