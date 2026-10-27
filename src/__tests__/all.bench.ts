import { test } from "vitest"
import type { AsyncDisposer } from "../types"
import * as try$ from "../index"
import { consume } from "./test-utils"

const signal = new AbortController().signal

const independentTasks = {
  a() {
    return 1
  },
  b() {
    return 2
  },
}

const dependencyTasks = {
  a() {
    return 1
  },
  async b(this: { $result: { a: Promise<number> } }) {
    return (await this.$result.a) + 1
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

test("all", async ({ bench }) => {
  await bench.compare(
    bench("baseline/promise-all-two-values", async () => {
      consume(await Promise.all([Promise.resolve(1), Promise.resolve(2)]))
    }),
    bench("all/two-independent-sync-tasks", async () => {
      consume(await try$.all(independentTasks))
    }),
    bench("all/two-independent-sync-tasks-with-signal", async () => {
      consume(await try$.signal(signal).all(independentTasks))
    }),
    bench("all/two-independent-sync-tasks-with-disposer", async () => {
      consume(await try$.all(disposerTasks))
    }),
    bench("all/two-node-dependency", async () => {
      consume(await try$.all(dependencyTasks))
    })
  )
})
