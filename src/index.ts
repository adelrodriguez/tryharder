import { RunBuilder } from "./lib/builder"
import {
  CancellationError,
  Panic,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "./lib/errors"
import { createRetryPolicy } from "./lib/modifiers/retry"

const root = new RunBuilder()

export const all: RunBuilder["all"] = root.all.bind(root)
export const allSettled: RunBuilder["allSettled"] = root.allSettled.bind(root)
export const flow: RunBuilder["flow"] = root.flow.bind(root)
export const gen: RunBuilder["gen"] = root.gen.bind(root)
export const retry: RunBuilder["retry"] = root.retry.bind(root)
export const run: RunBuilder["run"] = root.run.bind(root)
export const runSync: RunBuilder["runSync"] = root.runSync.bind(root)
export const signal: RunBuilder["signal"] = root.signal.bind(root)
export const timeout: RunBuilder["timeout"] = root.timeout.bind(root)

export const wrap: RunBuilder["wrap"] = root.wrap.bind(root)

export { dispose } from "./lib/dispose"

export { createRetryPolicy }
export { CancellationError, Panic, RetryExhaustedError, TimeoutError, UnhandledException }
export type { PanicCode } from "./lib/errors"

export type {
  AllSettledResult,
  SettledFulfilled,
  SettledRejected,
  SettledResult,
} from "./lib/types/all"
export type { FlowExit } from "./lib/executors/flow"
