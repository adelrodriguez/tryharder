import type { AsyncDisposer } from "../../shims/disposer"
import type { BuilderConfig } from "../builder"
import { createAsyncDisposer, defineAsyncDisposeAlias } from "../../shims/disposer"
import { Panic, UnhandledException } from "../errors"
import { invariant } from "../utils"
import { BaseExecution } from "./base"

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

interface TaskGraphRun<R> extends AsyncDisposable {
  execute(): Promise<R>
  waitForTasksToSettle(): Promise<void>
}

export type TaskGraphFailureOutcome<R> = { mapped: R } | { thrown: unknown }

interface TaskGraphOptions<R> {
  mapFailure?: (error: unknown) => TaskGraphFailureOutcome<R> | Promise<TaskGraphFailureOutcome<R>>
}

export abstract class OrchestrationExecution<TResult> extends BaseExecution<Promise<TResult>> {
  protected constructor(config: BuilderConfig) {
    invariant(
      config.retry === undefined,
      new Panic("ORCHESTRATION_UNSUPPORTED_POLICY", {
        message: "Orchestration does not support retry policies.",
      })
    )

    super(config)
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

  /**
   * Shared task-graph lifecycle: race execution against cancellation and the graph deadline, let
   * `mapFailure` turn a failure into a mapped result or a value to rethrow, wait for in-flight
   * tasks to settle before resolving (so no task code is still running once the orchestration
   * returns), and give control failures (cancellation first, then timeout) priority over whatever
   * was thrown while they fired.
   */
  protected async executeTaskGraph<R>(
    graph: TaskGraphRun<R>,
    options: TaskGraphOptions<R> = {}
  ): Promise<R> {
    await using execution = graph
    const { mapFailure = (error): TaskGraphFailureOutcome<R> => ({ thrown: error }) } = options
    let result!: R
    let threw = false
    let thrownError: unknown

    try {
      result = (await this.race(execution.execute())) as R
    } catch (error) {
      const outcome = await mapFailure(error)

      if ("mapped" in outcome) {
        result = outcome.mapped
      } else {
        threw = true
        thrownError = outcome.thrown
      }
    } finally {
      await execution.waitForTasksToSettle()
    }

    // Control state may have changed while tasks ran or settled, and it takes
    // priority over whatever was thrown; the shared chain reports cancellation
    // over the graph deadline when both fired.
    const controlError = this.checkDidControlFail(thrownError)

    if (controlError) {
      throw controlError
    }

    if (threw) {
      // oxlint-disable-next-line no-throw-literal, typescript/only-throw-error -- Preserve raw task failures for callers/tests.
      throw thrownError
    }

    return result
  }

  protected abstract executeTasks(): Promise<TResult>
}

export abstract class TaskGraphExecutionBase<
  T extends TaskRecord,
  TContext extends TaskContext<T>,
> implements AsyncDisposable {
  protected readonly tasks: T
  protected readonly taskNames: Array<keyof T & string>
  readonly #settlements = new Map<keyof T, PromiseWithResolvers<unknown>>()
  protected readonly internalController: AbortController = new AbortController()
  protected readonly taskSignal: AbortSignal
  protected readonly disposer: AsyncDisposer = createAsyncDisposer()
  protected firstRejection: unknown
  declare [Symbol.asyncDispose]: () => Promise<void>

  constructor(signal: AbortSignal | undefined, tasks: T) {
    this.tasks = tasks
    this.taskNames = Object.keys(tasks)
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

    return this.taskSettlement(taskName).promise
  }

  /**
   * Memoized per-task settlement: `$result` reads and `runTask` share one deferred per task, so the
   * promise itself broadcasts and caches the outcome. A task may synchronously read a sibling that
   * has not started yet, which is why the deferred is created on first access rather than derived
   * from the task's own execution promise.
   */
  private taskSettlement(taskName: keyof T): PromiseWithResolvers<unknown> {
    let settlement = this.#settlements.get(taskName)

    if (!settlement) {
      settlement = Promise.withResolvers<unknown>()
      // Keep a task failure from surfacing as an unhandled rejection when no
      // sibling reads its `$result`; failures still propagate via `runTask`.
      void settlement.promise.catch((error: unknown) => void error)
      this.#settlements.set(taskName, settlement)
    }

    return settlement
  }

  protected abortInternal(error: unknown): void {
    if (!this.internalController.signal.aborted) {
      this.internalController.abort(error)
    }
  }

  /**
   * Optional observation hooks: subclasses implement these to record task outcomes. These method
   * signatures are erased at compile time, so the base class leaves them undefined without emitting
   * fields that would shadow subclass prototype methods.
   */
  protected onTaskResult?(taskName: keyof T, value: unknown): void
  protected onTaskError?(taskName: keyof T, error: unknown): void

  // The three methods below are polymorphic defaults overridden by
  // subclasses (template-method pattern); they must stay instance methods
  // even though the base implementations do not touch `this`.

  // oxlint-disable-next-line class-methods-use-this -- polymorphic default
  protected mapStoredError(error: unknown): Error {
    return error instanceof Error ? error : new UnhandledException(undefined, { cause: error })
  }

  // oxlint-disable-next-line class-methods-use-this -- polymorphic default
  protected shouldAbortOnTaskError(_error: unknown): boolean {
    return false
  }

  // oxlint-disable-next-line class-methods-use-this -- polymorphic default
  protected shouldRethrowTaskError(_error: unknown): boolean {
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

      this.taskSettlement(taskName).resolve(result)
      this.onTaskResult?.(taskName, result)
    } catch (error) {
      this.setFirstRejection(error)
      this.taskSettlement(taskName).reject(this.mapStoredError(error))
      this.onTaskError?.(taskName, error)

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

abstract class TaskExecution<T extends TaskRecord> extends TaskGraphExecutionBase<
  T,
  TaskContext<T>
> {
  #settledPromise: Promise<Array<PromiseSettledResult<void>>> | undefined

  async waitForTasksToSettle(): Promise<void> {
    await this.#settledPromise
  }

  /**
   * Starts every task eagerly and captures the allSettled tracker up front so
   * `waitForTasksToSettle` works and task rejections are always observed.
   */
  protected startTasks(): Array<Promise<void>> {
    const promises = this.taskNames.map(async (name) => this.runTask(name))
    this.#settledPromise = Promise.allSettled(promises)
    return promises
  }

  protected override createTaskContext(resultProxy: ResultProxy<T>): TaskContext<T> {
    return {
      $disposer: this.disposer,
      $result: resultProxy,
      $signal: this.taskSignal,
    }
  }
}

export class FailFastTaskExecution<T extends TaskRecord> extends TaskExecution<T> {
  readonly #returnValue: Record<string, unknown> = {}
  #failedTask: (keyof T & string) | undefined

  get failedTask(): (keyof T & string) | undefined {
    return this.#failedTask
  }

  get signal(): AbortSignal {
    return this.taskSignal
  }

  get returnValue(): Record<string, unknown> {
    return this.#returnValue
  }

  async execute(): Promise<AllValue<T>> {
    try {
      await Promise.all(this.startTasks())
    } catch {
      throw this.mapStoredError(this.firstRejection)
    }

    return this.#returnValue as AllValue<T>
  }

  protected override onTaskResult(taskName: keyof T, value: unknown): void {
    this.#returnValue[taskName as string] = value
  }

  protected override onTaskError(taskName: keyof T): void {
    this.#failedTask ??= taskName as keyof T & string
  }

  // oxlint-disable-next-line class-methods-use-this -- polymorphic override
  protected override shouldAbortOnTaskError(): boolean {
    return true
  }
}

export class SettledTaskExecution<T extends TaskRecord> extends TaskExecution<T> {
  readonly #returnValue: Record<string, unknown> = {}

  async execute(): Promise<AllSettledResult<T>> {
    void this.startTasks()
    await this.waitForTasksToSettle()

    return this.#returnValue as AllSettledResult<T>
  }

  protected override onTaskResult(taskName: keyof T, value: unknown): void {
    this.#returnValue[taskName as string] = { status: "fulfilled", value }
  }

  protected override onTaskError(taskName: keyof T, error: unknown): void {
    this.#returnValue[taskName as string] = { reason: error, status: "rejected" }
  }

  // oxlint-disable-next-line class-methods-use-this -- polymorphic override
  protected override shouldRethrowTaskError(): boolean {
    return false
  }
}
