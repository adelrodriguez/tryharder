// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for task-map inference
export type TaskRecord = Record<string, any>

export type TaskValidation<T extends TaskRecord> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for function compatibility with contextual `this`
  [K in keyof T]: T[K] extends (...args: any[]) => any ? T[K] : never
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for function compatibility with contextual `this`
export type TaskResult<T> = T extends (...args: any[]) => infer R ? Awaited<R> : never

export type ResultProxy<T extends TaskRecord> = {
  readonly [K in keyof T]: Promise<TaskResult<T[K]>>
}

export interface TaskContext<T extends TaskRecord> {
  $result: ResultProxy<T>
  $signal: AbortSignal
  $disposer: AsyncDisposableStack
}

export type InferredTaskContext<T extends TaskRecord> = {
  $result: {
    readonly [K in keyof T]: ReturnType<T[K]> extends Promise<infer R>
      ? Promise<R>
      : Promise<ReturnType<T[K]>>
  }
  $signal: AbortSignal
  $disposer: AsyncDisposableStack
}

export type AllValue<T extends TaskRecord> = {
  [K in keyof T]: TaskResult<T[K]>
}

export interface AllCatchContext<T extends TaskRecord> {
  failedTask: (keyof T & string) | undefined
  partial: Partial<AllValue<T>>
  signal: AbortSignal
}

export type AllCatchFn<T extends TaskRecord, C> = (
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
