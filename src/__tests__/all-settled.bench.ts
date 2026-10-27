import { test } from "vitest"
import type { AsyncDisposer } from "../types"
import * as try$ from "../index"
import { consume } from "./test-utils"

const tasks = {
  a() {
    return 1
  },
  b() {
    return 2
  },
}

const disposerTasks = {
  a(this: { $disposer: AsyncDisposer }) {
    this.$disposer.defer(() => void 0)
    return 1
  },
  b(this: { $disposer: AsyncDisposer }) {
    this.$disposer.defer(() => void 0)
    return 2
  },
}

test("allSettled", async ({ bench }) => {
  await bench.compare(
    bench("allSettled/two-successful-tasks", async () => {
      consume(await try$.allSettled(tasks))
    }),
    bench("allSettled/two-successful-tasks-with-disposer", async () => {
      consume(await try$.allSettled(disposerTasks))
    })
  )
})
