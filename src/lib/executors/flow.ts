import type { BuilderConfig } from "../builder"
import type {
  InferredTaskContext,
  ResultProxy,
  TaskContext,
  TaskRecord,
  TaskResult,
} from "./shared"
import { Panic } from "../errors"
import { OrchestrationExecution, TaskGraphExecutionBase } from "./shared"

declare const FLOW_EXIT_BRAND: unique symbol

export type FlowExit<T> = {
  readonly [FLOW_EXIT_BRAND]: T
}

type ExitValue<T> = T extends FlowExit<infer V> ? V : never

type FlowExitValue<T extends TaskRecord> = {
  [K in keyof T]: ExitValue<TaskResult<T[K]>>
}[keyof T]

interface FlowTaskContext<T extends TaskRecord> extends TaskContext<T> {
  $exit<V>(value: V): FlowExit<V>
}

export type InferredFlowTaskContext<T extends TaskRecord> = InferredTaskContext<T> & {
  $exit<V>(value: V): FlowExit<V>
}

export type FlowResult<T extends TaskRecord> = FlowExitValue<T>

class FlowExitSignal extends Error {
  readonly value: unknown

  constructor(value: unknown) {
    super("Flow exited")
    this.name = "FlowExitSignal"
    this.value = value
  }
}

class FlowExecution<T extends TaskRecord> extends TaskGraphExecutionBase<T, FlowTaskContext<T>> {
  #firstRejectionWaiters: Array<() => void> = []
  #settledPromise: Promise<Array<PromiseSettledResult<void>>> | undefined

  async execute(): Promise<FlowResult<T>> {
    const promises = this.taskNames.map(async (name) => this.runTask(name))
    this.#settledPromise = Promise.allSettled(promises)

    // Race Promise.allSettled() against the first rejection recorded by runTask().
    await Promise.race([this.#settledPromise, this.waitForFirstRejection()])

    if (this.firstRejection !== undefined) {
      if (this.firstRejection instanceof FlowExitSignal) {
        return this.firstRejection.value as FlowResult<T>
      }

      throw this.firstRejection
    }

    throw new Panic("FLOW_NO_EXIT")
  }

  async waitForTasksToSettle(): Promise<void> {
    await this.#settledPromise
  }

  protected override setFirstRejection(error: unknown): void {
    const hadFirstRejection = this.firstRejection !== undefined

    super.setFirstRejection(error)

    if (hadFirstRejection || this.firstRejection === undefined) {
      return
    }

    for (const resolve of this.#firstRejectionWaiters) {
      resolve()
    }

    this.#firstRejectionWaiters = []
  }

  protected override createTaskContext(resultProxy: ResultProxy<T>): FlowTaskContext<T> {
    return {
      $disposer: this.disposer,
      $exit: (value) => {
        throw new FlowExitSignal(value)
      },
      $result: resultProxy,
      $signal: this.taskSignal,
    }
  }

  protected override mapStoredError(error: unknown): Error {
    if (error instanceof FlowExitSignal) {
      return error
    }

    return super.mapStoredError(error)
  }

  protected override shouldAbortOnTaskError(): boolean {
    void this.taskNames
    return true
  }

  private waitForFirstRejection(): Promise<void> {
    if (this.firstRejection !== undefined) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      this.#firstRejectionWaiters.push(resolve)
    })
  }
}

class FlowRunnerExecution<T extends TaskRecord> extends OrchestrationExecution<FlowResult<T>> {
  readonly #tasks: T

  constructor(config: BuilderConfig, tasks: T) {
    super(config)
    this.#tasks = tasks
  }

  protected override async executeTasks(): Promise<FlowResult<T>> {
    await using execution = new FlowExecution(this.executionSignal, this.#tasks)
    let result!: FlowResult<T>
    let threw = false
    let thrownError: unknown

    try {
      result = (await this.raceWithCancellation(execution.execute())) as FlowResult<T>
    } catch (error) {
      threw = true
      thrownError = error
    } finally {
      await execution.waitForTasksToSettle()
    }

    const cancellation = this.checkDidCancel(thrownError)

    if (cancellation) {
      throw cancellation
    }

    if (threw) {
      throw thrownError
    }

    return result
  }
}

export async function executeFlow<T extends TaskRecord>(
  config: BuilderConfig,
  tasks: T & ThisType<InferredFlowTaskContext<T>>
): Promise<FlowResult<T>> {
  using execution = new FlowRunnerExecution(config, tasks)
  return await execution.execute()
}
