import type { WrappedRunBuilder } from "./lib/builder"
import type { WrapFn } from "./lib/types/builder"
import { RunBuilder, createWrappedBuilder } from "./lib/builder"
import {
  CancellationError,
  Panic,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "./lib/errors"
import { retryOptions } from "./lib/retry"

const root = new RunBuilder()

export const retry: RunBuilder["retry"] = root.retry.bind(root)
export const timeout: RunBuilder["timeout"] = root.timeout.bind(root)
export const signal: RunBuilder["signal"] = root.signal.bind(root)
export const wrap = (fn: WrapFn): WrappedRunBuilder => createWrappedBuilder(fn)
export const run: RunBuilder["run"] = root.run.bind(root)
export { runSync } from "./lib/run-sync"

export const all: RunBuilder["all"] = root.all.bind(root)
export const allSettled: RunBuilder["allSettled"] = root.allSettled.bind(root)
export const flow: RunBuilder["flow"] = root.flow.bind(root)

export { dispose } from "./lib/dispose"
export { executeGen as gen } from "./lib/gen"

export { retryOptions }
export { CancellationError, Panic, RetryExhaustedError, TimeoutError, UnhandledException }

export type {
  AllSettledResult,
  SettledFulfilled,
  SettledRejected,
  SettledResult,
} from "./lib/types/all"
export type { FlowExit } from "./lib/flow"
