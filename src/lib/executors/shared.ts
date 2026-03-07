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

export abstract class TaskGraphExecutionBase<
  T extends TaskRecord,
  TContext extends TaskContext<T>,
> {
  protected readonly tasks: T
  protected readonly taskNames: Array<keyof T & string>
  protected readonly results = new Map<keyof T, unknown>()
  protected readonly errors = new Map<keyof T, unknown>()
  protected readonly resolvers = new Map<keyof T, ResolverPair[]>()
  protected readonly internalController = new AbortController()
  protected readonly taskSignal: AbortSignal
  protected readonly disposer = new AsyncDisposableStack()
  protected firstRejection: unknown

  constructor(signal: AbortSignal | undefined, tasks: T) {
    this.tasks = tasks
    this.taskNames = Object.keys(tasks) as Array<keyof T & string>
    this.taskSignal = signal
      ? AbortSignal.any([signal, this.internalController.signal])
      : this.internalController.signal
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disposer.disposeAsync()
  }

  protected getTaskHandler(taskName: keyof T) {
    const taskFn = this.tasks[taskName]

    invariant(
      typeof taskFn === "function",
      new Panic("TASK_INVALID_HANDLER", {
        message: `Task "${String(taskName)}" is not a function`,
      })
    )

    return taskFn as (this: TContext) => unknown
  }

  protected createResultProxy(requesterTaskName: keyof T): ResultProxy<T> {
    return new Proxy({} as ResultProxy<T>, {
      get: (_, referencedTaskName: string) =>
        this.waitForResult(referencedTaskName as keyof T, requesterTaskName),
    })
  }

  protected waitForResult(taskName: keyof T, requesterTaskName?: keyof T): Promise<unknown> {
    if (requesterTaskName === taskName) {
      return Promise.reject(
        new Panic("TASK_SELF_REFERENCE", {
          message: `Task "${String(taskName)}" cannot await its own result`,
        })
      )
    }

    if (!Object.hasOwn(this.tasks, taskName)) {
      return Promise.reject(
        new Panic("TASK_UNKNOWN_REFERENCE", {
          message: `Unknown task "${String(taskName)}"`,
        })
      )
    }

    if (this.results.has(taskName)) {
      return Promise.resolve(this.results.get(taskName))
    }

    if (this.errors.has(taskName)) {
      const storedError = this.mapStoredError(this.errors.get(taskName))

      return Promise.reject(storedError)
    }

    return new Promise((resolve, reject) => {
      const queue = this.resolvers.get(taskName)

      if (queue) {
        queue.push([resolve, reject])
        return
      }

      this.resolvers.set(taskName, [[resolve, reject]])
    })
  }

  protected storeResult(taskName: keyof T, value: unknown): void {
    this.results.set(taskName, value)
    this.resolveWaiters(taskName, value)
  }

  protected storeError(taskName: keyof T, error: unknown): void {
    const mappedError = this.mapStoredError(error)

    this.errors.set(taskName, mappedError)
    this.rejectWaiters(taskName, mappedError)
  }

  protected resolveWaiters(taskName: keyof T, value: unknown): void {
    const fulfilled = this.resolvers.get(taskName)

    if (fulfilled) {
      for (const [resolve] of fulfilled) {
        resolve(value)
      }

      this.resolvers.delete(taskName)
    }
  }

  protected rejectWaiters(taskName: keyof T, error: unknown): void {
    const rejected = this.resolvers.get(taskName)

    if (rejected) {
      for (const [, reject] of rejected) {
        reject(error)
      }

      this.resolvers.delete(taskName)
    }
  }

  protected abortInternal(error: unknown): void {
    if (!this.internalController.signal.aborted) {
      this.internalController.abort(error)
    }
  }

  protected onTaskResult(_taskName: keyof T, _value: unknown): void {
    void this.tasks
    void _taskName
    void _value
  }

  protected onTaskError(_taskName: keyof T, _error: unknown): void {
    void this.tasks
    void _taskName
    void _error
  }

  protected mapStoredError(error: unknown): Error {
    void this.tasks
    return error instanceof Error ? error : new UnhandledException(undefined, { cause: error })
  }

  protected shouldAbortOnTaskError(_error: unknown): boolean {
    void this.tasks
    void _error
    return false
  }

  protected shouldRethrowTaskError(_error: unknown): boolean {
    void this.tasks
    void _error
    return true
  }

  protected setFirstRejection(error: unknown): void {
    this.firstRejection ??= error
  }

  protected abstract createTaskContext(resultProxy: ResultProxy<T>): TContext

  protected async runTask(taskName: keyof T): Promise<void> {
    try {
      const taskFn = this.getTaskHandler(taskName)
      const resultProxy = this.createResultProxy(taskName)
      const context = this.createTaskContext(resultProxy)
      const result = await taskFn.call(context)

      this.storeResult(taskName, result)
      this.onTaskResult(taskName, result)
    } catch (error) {
      this.setFirstRejection(error)
      this.storeError(taskName, error)
      this.onTaskError(taskName, error)

      if (this.shouldAbortOnTaskError(error)) {
        this.abortInternal(error)
      }

      if (this.shouldRethrowTaskError(error)) {
        throw error
      }
    }
  }
}

export class TaskExecution<T extends TaskRecord> extends TaskGraphExecutionBase<T, TaskContext<T>> {
  readonly #mode: TaskExecutionMode
  readonly #returnValue: Record<string, unknown> = {}
  #failedTask: (keyof T & string) | undefined
  private settledPromise: Promise<Array<PromiseSettledResult<void>>> | undefined

  constructor(signal: AbortSignal | undefined, tasks: T, mode: TaskExecutionMode) {
    super(signal, tasks)
    this.#mode = mode
  }

  get failedTask(): (keyof T & string) | undefined {
    return this.#failedTask
  }

  get signal(): AbortSignal {
    return this.taskSignal
  }

  get returnValue(): Record<string, unknown> {
    return this.#returnValue
  }

  async execute(): Promise<Record<string, unknown>> {
    const promises = this.taskNames.map(async (name) => this.runTask(name))
    this.settledPromise = Promise.allSettled(promises)

    if (this.#mode === "settled") {
      await this.settledPromise
      return this.#returnValue
    }

    try {
      await Promise.all(promises)
    } catch {
      throw this.mapStoredError(this.firstRejection)
    }

    return this.#returnValue
  }

  async waitForTasksToSettle(): Promise<void> {
    await this.settledPromise
  }

  protected override createTaskContext(resultProxy: ResultProxy<T>): TaskContext<T> {
    return {
      $disposer: this.disposer,
      $result: resultProxy,
      $signal: this.taskSignal,
    }
  }

  protected override onTaskResult(taskName: keyof T, value: unknown): void {
    if (this.#mode === "settled") {
      this.#returnValue[taskName as string] = { status: "fulfilled", value }
    } else {
      this.#returnValue[taskName as string] = value
    }
  }

  protected override onTaskError(taskName: keyof T, error: unknown): void {
    this.#failedTask ??= taskName as keyof T & string

    if (this.#mode === "settled") {
      this.#returnValue[taskName as string] = { reason: error, status: "rejected" }
    }
  }

  protected override shouldAbortOnTaskError(): boolean {
    return this.#mode === "fail-fast"
  }

  protected override shouldRethrowTaskError(): boolean {
    return this.#mode === "fail-fast"
  }
}
