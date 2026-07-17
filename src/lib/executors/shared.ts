import type { AsyncDisposer } from "../../shims/disposer"
import type { BuilderConfig } from "../builder"
import { createAsyncDisposer, defineAsyncDisposeAlias } from "../../shims/disposer"
import { Panic, UnhandledException } from "../errors"
import { invariant } from "../utils"
import { BaseExecution } from "./base"

type ResolverPair = [(value: unknown) => void, (reason?: unknown) => void]

type TaskExecutionMode = "fail-fast" | "settled"

// oxlint-disable-next-line no-explicit-any -- Required for task-map inference
export type TaskRecord = Record<string, any>

export type TaskValidation<T extends TaskRecord> = {
  // oxlint-disable-next-line no-explicit-any -- Required for function compatibility with contextual `this`
  [K in keyof T]: T[K] extends (...args: any[]) => any ? T[K] : never
}

// oxlint-disable-next-line no-explicit-any -- Required for function compatibility with contextual `this`
export type TaskResult<T> = T extends (...args: any[]) => infer R ? Awaited<R> : never

export type ResultProxy<T extends TaskRecord> = {
  readonly [K in keyof T]: Promise<TaskResult<T[K]>>
}

export interface TaskContext<T extends TaskRecord> {
  $result: ResultProxy<T>
  $signal: AbortSignal
  $disposer: AsyncDisposer
}

export type InferredTaskContext<T extends TaskRecord> = {
  $result: {
    readonly [K in keyof T]: ReturnType<T[K]> extends Promise<infer R>
      ? Promise<R>
      : Promise<ReturnType<T[K]>>
  }
  $signal: AbortSignal
  $disposer: AsyncDisposer
}

export type AllValue<T extends TaskRecord> = {
  [K in keyof T]: TaskResult<T[K]>
}

interface AllCatchContext<T extends TaskRecord> {
  failedTask: (keyof T & string) | undefined
  partial: Partial<AllValue<T>>
  signal: AbortSignal
}

type AllCatchFn<T extends TaskRecord, C> = (
  error: unknown,
  ctx: AllCatchContext<T>
) => C | Promise<C>

export interface AllOptions<T extends TaskRecord, C> {
  catch: AllCatchFn<T, C>
}

export interface SettledFulfilled<T> {
  status: "fulfilled"
  value: T
}

export interface SettledRejected {
  status: "rejected"
  reason: unknown
}

export type SettledResult<T> = SettledFulfilled<T> | SettledRejected

export type AllSettledResult<T extends TaskRecord> = {
  [K in keyof T]: SettledResult<TaskResult<T[K]>>
}

interface RetryInfo {
  attempt: number
  limit: number
}

export interface BaseTryCtx {
  signal?: AbortSignal
}

export type TryCtxFor<HasRetry extends boolean> = BaseTryCtx &
  (HasRetry extends true ? { retry: RetryInfo } : Record<never, never>)

export type TryCtx = TryCtxFor<true>

export type NonPromise<T> = T extends PromiseLike<unknown> ? never : T

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
> implements AsyncDisposable {
  protected readonly tasks: T
  protected readonly taskNames: Array<keyof T & string>
  protected readonly results!: Map<keyof T, unknown>
  protected readonly errors!: Map<keyof T, unknown>
  protected readonly resolvers!: Map<keyof T, ResolverPair[]>
  protected readonly internalController: AbortController = new AbortController()
  protected readonly taskSignal: AbortSignal
  protected readonly disposer: AsyncDisposer = createAsyncDisposer()
  protected firstRejection: unknown
  declare [Symbol.asyncDispose]: () => Promise<void>

  constructor(signal: AbortSignal | undefined, tasks: T) {
    this.tasks = tasks
    this.taskNames = Object.keys(tasks)
    this.results = new Map<keyof T, unknown>()
    this.errors = new Map<keyof T, unknown>()
    this.resolvers = new Map<keyof T, ResolverPair[]>()
    this.taskSignal = signal
      ? AbortSignal.any([signal, this.internalController.signal])
      : this.internalController.signal
  }

  async dispose(): Promise<void> {
    await this.disposer.dispose()
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
        this.waitForResult(referencedTaskName, requesterTaskName),
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
defineAsyncDisposeAlias(TaskGraphExecutionBase.prototype)

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
    this.#returnValue[taskName as string] =
      this.#mode === "settled" ? { status: "fulfilled", value } : value
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
