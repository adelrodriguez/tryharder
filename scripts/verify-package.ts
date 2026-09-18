import { execFileSync } from "node:child_process"
import { existsSync, rmSync, writeFileSync } from "node:fs"

const outputPaths = [
  "dist/errors.d.ts",
  "dist/errors.js",
  "dist/index.d.ts",
  "dist/index.js",
  "dist/types.d.ts",
  "dist/types.js",
] as const

for (const path of outputPaths) {
  if (!existsSync(path)) {
    throw new Error(`Missing package output: ${path}`)
  }
}

const rootSpecifier = "tryharder"
const errorsSpecifier = "tryharder/errors"
const typesSpecifier = "tryharder/types"
const rootModule: unknown = await import(rootSpecifier)
const errorsModule: unknown = await import(errorsSpecifier)
const typesModule: unknown = await import(typesSpecifier)

assertExports(
  rootModule,
  [
    "all",
    "allSettled",
    "disposer",
    "flow",
    "gen",
    "retry",
    "retryOptions",
    "run",
    "runSync",
    "signal",
    "timeout",
    "wrap",
  ],
  "tryharder"
)
assertExports(
  errorsModule,
  [
    "CancellationError",
    "Panic",
    "RetryExhaustedError",
    "TimeoutError",
    "UnhandledException",
    "isCancellationError",
    "isPanic",
    "isRetryExhaustedError",
    "isTimeoutError",
    "isUnhandledException",
  ],
  "tryharder/errors"
)
assertExports(typesModule, [], "tryharder/types")

const run = rootModule.run
if (typeof run !== "function") {
  throw new Error("tryharder does not export run()")
}

const runResult: unknown = await Reflect.apply(run, undefined, [() => 42])
if (runResult !== 42) {
  throw new Error(`Expected run() to return 42, received ${String(runResult)}`)
}

const consumerPath = "dist/node-next-consumer.ts"
writeFileSync(
  consumerPath,
  `import { run, timeout } from "tryharder"
import { TimeoutError, type UnhandledException } from "tryharder/errors"
import type { AsyncDisposer, FlowExit, SettledResult } from "tryharder/types"

const result: Promise<number | UnhandledException> = run(() => 42)
const timeoutResult: Promise<number | TimeoutError | UnhandledException> = timeout(100).run(() => 42)
declare const disposer: AsyncDisposer
declare const exit: FlowExit<string>
declare const settled: SettledResult<number>

void disposer
void exit
void result
void settled
void timeoutResult
`
)

try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "false",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ESNext",
      consumerPath,
    ],
    { stdio: "inherit" }
  )
} finally {
  rmSync(consumerPath, { force: true })
}

function assertExports(
  namespace: unknown,
  expected: readonly string[],
  entrypoint: string
): asserts namespace is Record<string, unknown> {
  if (!isRecord(namespace)) {
    throw new Error(`${entrypoint} did not load as a module namespace`)
  }

  const actual = Object.keys(namespace)
  const hasExpectedExports =
    actual.length === expected.length && expected.every((name) => Object.hasOwn(namespace, name))

  if (!hasExpectedExports) {
    throw new Error(`Unexpected ${entrypoint} exports: ${actual.join(", ")}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
