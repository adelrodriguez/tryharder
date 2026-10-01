// Runs the built bundle on the minimum supported runtime.
//
// The README declares the floor: `AbortSignal.any` and `Promise.withResolvers`.
// This script removes globals that are newer than that floor, so a runtime
// that is newer than the floor behaves like one at the floor.
//
// Usage: node scripts/compat-smoke.mjs [dist directory]

import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const distDir = resolve(process.argv[2] ?? "dist")

if (typeof AbortSignal.any !== "function" || typeof Promise.withResolvers !== "function") {
  throw new Error("This runtime is below the supported floor")
}

delete Error.isError
globalThis.DisposableStack = undefined
globalThis.AsyncDisposableStack = undefined

const NativeSymbol = globalThis.Symbol
/**
 * @param {string} [description]
 */
const SymbolShim = function (description) {
  return NativeSymbol(description)
}
const symbolDescriptors = Object.getOwnPropertyDescriptors(NativeSymbol)
delete symbolDescriptors.dispose
delete symbolDescriptors.asyncDispose
Object.defineProperties(SymbolShim, symbolDescriptors)
for (const key of ["dispose", "asyncDispose"]) {
  Object.defineProperty(SymbolShim, key, { configurable: true, value: undefined, writable: true })
}
globalThis.Symbol = SymbolShim

/**
 * @type {typeof import("../src/index")}
 */
const try$ = await import(pathToFileURL(resolve(distDir, "index.js")).href)
/**
 * @type {typeof import("../src/errors")}
 */
const errors = await import(pathToFileURL(resolve(distDir, "errors.js")).href)

function check(condition, message) {
  if (!condition) {
    throw new Error(`Compatibility smoke test failed: ${message}`)
  }
}

const runResult = await try$.run(() => 1)
check(Object.is(runResult, 1), "run() returns the value")

const failure = await try$.run(() => {
  throw new Error("boom")
})
check(failure instanceof errors.UnhandledException, "run() returns UnhandledException")

const runSyncResult = try$.runSync(() => 2)
check(Object.is(runSyncResult, 2), "runSync() returns the value")

const allResult = await try$.all({
  a() {
    return 1
  },
})
check(Object.is(allResult.a, 1), "all() returns the values")

const flowResult = await try$.flow({
  a() {
    return this.$exit("done")
  },
})
check(Object.is(flowResult, "done"), "flow() returns the exit value")

let cleaned = false
const disposer = try$.disposer()
disposer.defer(() => {
  cleaned = true
})
await disposer.dispose()
check(cleaned, "disposer() runs cleanup")

const guards = [
  [errors.isCancellationError, new errors.CancellationError()],
  [errors.isTimeoutError, new errors.TimeoutError()],
  [errors.isRetryExhaustedError, new errors.RetryExhaustedError()],
  [errors.isUnhandledException, new errors.UnhandledException()],
  [errors.isPanic, new errors.Panic("FLOW_NO_EXIT")],
]

for (const [guard, error] of guards) {
  check(guard(error), `${guard.name}() accepts its error`)

  const copy = new Error("copy")
  copy.name = error.name
  if (error instanceof errors.Panic) {
    copy.code = error.code
  }
  check(guard(copy), `${guard.name}() accepts an error from another copy`)

  const nonErrors = {
    "a plain object": { name: error.name },
    "a string": error.name,
    "a success value": runResult,
    null: null,
    undefined,
  }

  for (const [label, value] of Object.entries(nonErrors)) {
    check(!guard(value), `${guard.name}() rejects ${label}`)
  }
}
