import { describe, expect, it } from "bun:test"
import { dispose } from "../dispose"

describe("dispose", () => {
  it("disposes registered cleanups in reverse order", async () => {
    const calls: string[] = []
    const disposer = dispose()

    disposer.defer(() => {
      calls.push("defer:first")
    })

    disposer.use({
      async [Symbol.asyncDispose]() {
        await Promise.resolve()
        calls.push("use:resource")
      },
    })

    disposer.defer(() => {
      calls.push("defer:last")
    })

    await disposer[Symbol.asyncDispose]()

    expect(calls).toEqual(["defer:last", "use:resource", "defer:first"])
  })

  it("continues cleanup when one deferred cleanup throws", async () => {
    const calls: string[] = []
    const disposer = dispose()

    disposer.defer(() => {
      calls.push("first")
    })

    disposer.defer(() => {
      calls.push("second")
      throw new Error("cleanup failed")
    })

    disposer.defer(() => {
      calls.push("third")
    })

    try {
      await disposer[Symbol.asyncDispose]()
      throw new Error("Expected cleanup to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }

    expect(calls).toEqual(["third", "second", "first"])
  })
})
