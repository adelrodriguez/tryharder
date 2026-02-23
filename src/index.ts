import type {
  AsyncRunInput,
  AsyncRunTryFn,
  RunAsyncOptions,
  RunOptions,
  SyncRunInput,
  SyncRunTryFn,
} from "./lib/types/run"
import { TryBuilder } from "./lib/builder"
import {
  CancellationError,
  Panic,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "./lib/errors"
import { retryOptions } from "./lib/retry"

const root = new TryBuilder()

export const retry: TryBuilder["retry"] = root.retry.bind(root)
export const timeout: TryBuilder["timeout"] = root.timeout.bind(root)
export const signal: TryBuilder["signal"] = root.signal.bind(root)
export const wrap: TryBuilder["wrap"] = root.wrap.bind(root)

export function run<T>(tryFn: SyncRunTryFn<T>): T | UnhandledException
export function run<T, C>(options: RunOptions<T, C>): T | C
export function run<T, C>(input: SyncRunInput<T, C>) {
  // Overloads define the public API; this cast funnels to TryBuilder.run's union input implementation.
  // Keep this in sync with `TryBuilder.run` signatures to avoid hiding drift.
  return root.run(input as never)
}

export function runAsync<T>(
  tryFn: SyncRunTryFn<T> | AsyncRunTryFn<T>
): Promise<T | UnhandledException>
export function runAsync<T, C>(options: RunAsyncOptions<T, C>): Promise<T | C>
export function runAsync<T, C>(input: AsyncRunInput<T, C>) {
  // Overloads define the public API; this implementation forwards the same union input to TryBuilder.runAsync.
  // Keep this in sync with `TryBuilder.runAsync` signatures to avoid overload drift.
  return root.runAsync(input)
}

export const all: TryBuilder["all"] = root.all.bind(root)
export const allSettled: TryBuilder["allSettled"] = root.allSettled.bind(root)
export const flow: TryBuilder["flow"] = root.flow.bind(root)

export { dispose } from "./lib/dispose"
export { executeGen as gen } from "./lib/gen"

export { retryOptions }
export { CancellationError, Panic, RetryExhaustedError, TimeoutError, UnhandledException }
