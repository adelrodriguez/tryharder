import { test } from "vitest"
import * as try$ from "../index"
import { consume } from "./test-utils"

const exitTasks = {
  a(this: { $exit(value: string): never }) {
    return this.$exit("done")
  },
}

const dependencyExitTasks = {
  a() {
    return 1
  },
  async b(this: { $result: { a: Promise<number> }; $exit(value: string): never }) {
    return this.$exit(`done:${await this.$result.a}`)
  },
}

test("flow", async ({ bench }) => {
  await bench.compare(
    bench("flow/immediate-exit", async () => {
      consume(await try$.flow(exitTasks))
    }),
    bench("flow/two-node-dependency-then-exit", async () => {
      consume(await try$.flow(dependencyExitTasks))
    })
  )
})
