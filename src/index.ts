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

export const run: TryBuilder["run"] = root.run.bind(root)
export const all: TryBuilder["all"] = root.all.bind(root)
export const allSettled: TryBuilder["allSettled"] = root.allSettled.bind(root)
export const flow: TryBuilder["flow"] = root.flow.bind(root)

export { createDisposer as dispose } from "./lib/dispose"
export { executeGen as gen } from "./lib/gen"

export { retryOptions }
export { CancellationError, Panic, RetryExhaustedError, TimeoutError, UnhandledException }
