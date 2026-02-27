import type {
  AllOptions,
  AllSettledResult,
  AllValue,
  ResultProxy,
  TaskContext,
  TaskRecord,
} from "./types/all"
import type { BuilderConfig } from "./types/builder"
import type { TryCtx } from "./types/core"
import type { RunTryFn } from "./types/run"
import { Panic, TimeoutError } from "./errors"
import { TimeoutController } from "./timeout"
import { checkIsPromiseLike } from "./utils"

function executeWithWraps(wraps: BuilderConfig["wraps"], ctx: TryCtx, run: () => unknown): unknown {
  if (!wraps || wraps.length === 0) {
    return run()
  }

  let next: RunTryFn<unknown, TryCtx> = (_ctx) => run()

  for (const wrap of wraps.toReversed()) {
    const previous: RunTryFn<unknown, TryCtx> = next

    next = (currentCtx) => wrap(currentCtx, previous)
  }

  return next(ctx)
}

type ResolverPair = [(value: unknown) => void, (reason?: unknown) => void]

class AllExecution<T extends TaskRecord, C> {
  readonly #tasks: T
  readonly #config: BuilderConfig
  readonly #settled: boolean
  readonly #options: AllOptions<T, C> | undefined
  readonly #taskNames: Array<keyof T & string>
  readonly #results = new Map<keyof T, unknown>()
  readonly #errors = new Map<keyof T, unknown>()
  readonly #resolvers = new Map<keyof T, ResolverPair[]>()
  readonly #returnValue: Record<string, unknown> = {}
  readonly #internalController = new AbortController()
  readonly #cleanupController = new AbortController()
  readonly #timeout: TimeoutController
  readonly #disposer = new AsyncDisposableStack()
  #failedTask: (keyof T & string) | undefined

  constructor(config: BuilderConfig, tasks: T, settled: boolean, options?: AllOptions<T, C>) {
    this.#config = config
    this.#tasks = tasks
    this.#settled = settled
    this.#options = options
    this.#taskNames = Object.keys(tasks) as Array<keyof T & string>
    this.#timeout = new TimeoutController(config.timeout)

    const externalSignals = [...(config.signals ?? []), this.#timeout.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined
    )

    for (const sig of externalSignals) {
      if (sig.aborted) {
        this.#internalController.abort(sig.reason)
      } else {
        sig.addEventListener(
          "abort",
          () => {
            this.#internalController.abort(sig.reason)
          },
          {
            once: true,
            signal: this.#cleanupController.signal,
          }
        )
      }
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#cleanupController.abort()
    this.#timeout[Symbol.dispose]()
    await this.#disposer.disposeAsync()
  }

  async execute(): Promise<AllValue<T> | AllSettledResult<T> | C> {
    return (await Promise.resolve(
      executeWithWraps(
        this.#config.wraps,
        {
          retry: { attempt: 1, limit: 1 },
          signal: this.#internalController.signal,
        },
        () => this.#executeTasks()
      )
    )) as AllValue<T> | AllSettledResult<T> | C
  }

  async #executeTasks(): Promise<AllValue<T> | AllSettledResult<T> | C> {
    const promises = this.#taskNames.map(async (name) => this.#runTask(name))

    try {
      if (this.#settled) {
        const result = await this.#timeout.race(
          Promise.allSettled(promises).then(() => this.#returnValue as AllSettledResult<T>)
        )

        if (result instanceof TimeoutError) {
          throw result
        }

        return result
      }

      const result = await this.#timeout.race(
        Promise.all(promises).then(() => this.#returnValue as AllValue<T>)
      )

      if (result instanceof TimeoutError) {
        throw result
      }

      return result
    } catch (error) {
      if (!this.#settled && this.#options?.catch) {
        const catchFn = this.#options.catch
        const context = {
          failedTask: this.#failedTask,
          partial: this.#returnValue as Partial<AllValue<T>>,
          signal: this.#internalController.signal,
        }

        try {
          const mapped = catchFn(error, context)

          if (checkIsPromiseLike(mapped)) {
            return await mapped
          }

          return mapped
        } catch (catchError) {
          throw new Panic({ cause: catchError })
        }
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

    if (this.#settled) {
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

    if (this.#settled) {
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

      if (typeof taskFn !== "function") {
        throw new Error(`Task "${String(taskName)}" is not a function`)
      }

      const resultProxy = new Proxy({} as ResultProxy<T>, {
        get: (_, referencedTaskName: string) =>
          this.#waitForResult(referencedTaskName as keyof T, taskName),
      })

      const context: TaskContext<T> = {
        $disposer: this.#disposer,
        $result: resultProxy,
        $signal: this.#internalController.signal,
      }

      const result = await (taskFn as (this: TaskContext<T>) => unknown).call(context)

      this.#handleResult(taskName, result)
    } catch (error) {
      this.#handleError(taskName, error)

      if (!this.#settled) {
        this.#internalController.abort(error)
        throw error
      }
    }
  }
}

export function executeAllCore<T extends TaskRecord, C>(
  config: BuilderConfig,
  tasks: T,
  settled: boolean,
  options?: AllOptions<T, C>
): Promise<AllValue<T> | AllSettledResult<T> | C> {
  return (async () => {
    await using execution = new AllExecution(config, tasks, settled, options)
    return await execution.execute()
  })()
}
