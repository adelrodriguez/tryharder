import { test } from "vitest"
import * as try$ from "../index"
import { consume } from "./test-utils"

const DIRECT_RESULT = 42

function directSyncCall() {
  return DIRECT_RESULT
}

function directAsyncCall() {
  return Promise.resolve(DIRECT_RESULT)
}

test("runSync", async ({ bench }) => {
  await bench.compare(
    bench("baseline/direct-sync-call", () => {
      consume(directSyncCall())
    }),
    bench("runSync/function/success", () => {
      consume(try$.runSync(() => DIRECT_RESULT))
    }),
    bench("runSync/object/success", () => {
      consume(
        try$.runSync({
          catch: () => "mapped",
          try: () => DIRECT_RESULT,
        })
      )
    }),
    bench("runSync/object/mapped-error", () => {
      consume(
        try$.runSync({
          catch: () => "mapped",
          try: () => {
            throw new Error("boom")
          },
        })
      )
    })
  )
})

test("run", async ({ bench }) => {
  await bench.compare(
    bench("baseline/direct-async-call", async () => {
      consume(await directAsyncCall())
    }),
    bench("run/function/sync-success", async () => {
      consume(await try$.run(() => DIRECT_RESULT))
    }),
    bench("run/function/async-success", async () => {
      consume(await try$.run(async () => await directAsyncCall()))
    }),
    bench("run/object/mapped-error", async () => {
      consume(
        await try$.run({
          catch: () => "mapped",
          try: () => {
            throw new Error("boom")
          },
        })
      )
    })
  )
})
