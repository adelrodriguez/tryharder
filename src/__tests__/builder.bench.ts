import { test } from "vitest"
import * as try$ from "../index"
import { consume } from "./test-utils"

const signal = new AbortController().signal
const retryBuilder = try$.retry(3)
const signalRunSyncBuilder = try$.signal(signal) as unknown as {
  runSync<T>(tryFn: () => T): T
}
const signalRunBuilder = try$.signal(signal)
const timeoutBuilder = try$.timeout(60_000)
const timeoutAsyncBuilder = try$.timeout(60_000)
const signalTimeoutBuilder = try$.signal(signal).timeout(60_000)
const wrapBuilder = try$.wrap((_, next) => next())

test("builder/sync", async ({ bench }) => {
  await bench.compare(
    bench("builder/retry-timeout-signal-chain", () => {
      consume(try$.retry(3).timeout(60_000).signal(signal))
    }),
    bench("retry/runSync/succeeds-on-third-attempt", () => {
      let attempts = 0

      consume(
        retryBuilder.runSync(() => {
          attempts += 1

          if (attempts < 3) {
            throw new Error("retry")
          }

          return attempts
        })
      )
    }),
    bench("signal/runSync/success", () => {
      consume(signalRunSyncBuilder.runSync(() => 42))
    }),
    bench("wrap/runSync/success", () => {
      consume(wrapBuilder.runSync(() => 42))
    })
  )
})

test("builder/async", async ({ bench }) => {
  await bench.compare(
    bench("timeout/run/success-no-expiry", async () => {
      consume(await timeoutBuilder.run(() => 42))
    }),
    bench("signal/run/async-success-no-abort", async () => {
      consume(await signalRunBuilder.run(() => Promise.resolve(42)))
    }),
    bench("timeout/run/async-success-no-expiry", async () => {
      consume(await timeoutAsyncBuilder.run(() => Promise.resolve(42)))
    }),
    bench("signal-timeout/run/async-success-no-abort-no-expiry", async () => {
      consume(await signalTimeoutBuilder.run(() => Promise.resolve(42)))
    })
  )
})
