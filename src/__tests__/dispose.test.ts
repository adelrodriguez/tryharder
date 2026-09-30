import { describe, expect, it } from "vitest"
import * as try$ from "../index"

describe("disposer", () => {
  it("does not expose legacy cleanup method names", () => {
    const disposer = try$.disposer()

    expect("add" in disposer).toBe(false)
    expect("cleanup" in disposer).toBe(false)
    expect("disposeAsync" in disposer).toBe(false)
  })

  it("disposes deferred callbacks and sync and async resources once, in reverse order", async () => {
    const calls: string[] = []
    const disposer = try$.disposer()
    const syncResource = {
      [Symbol.dispose]() {
        calls.push("use:sync")
      },
    }
    const asyncResource = {
      async [Symbol.asyncDispose]() {
        await Promise.resolve()
        calls.push("use:async")
      },
    }

    disposer.defer(() => {
      calls.push("defer:first")
    })

    expect(disposer.use(syncResource)).toBe(syncResource)
    expect(disposer.use(asyncResource)).toBe(asyncResource)

    disposer.defer(() => {
      calls.push("defer:last")
    })

    await disposer.dispose()
    await disposer.dispose()

    expect(calls).toEqual(["defer:last", "use:async", "use:sync", "defer:first"])
  })

  it("disposes when leaving an await using scope", async () => {
    const calls: string[] = []

    {
      await using disposer = try$.disposer()

      disposer.defer(() => {
        calls.push("cleanup")
      })

      expect(calls).toEqual([])
    }

    expect(calls).toEqual(["cleanup"])
  })

  it("continues cleanup when one deferred cleanup throws", async () => {
    const failure = new Error("cleanup failed")
    const calls: string[] = []
    const disposer = try$.disposer()

    disposer.defer(() => {
      calls.push("first")
    })

    disposer.defer(() => {
      calls.push("second")
      throw failure
    })

    disposer.defer(() => {
      calls.push("third")
    })

    try {
      await disposer.dispose()
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(failure)
    }

    expect(calls).toEqual(["third", "second", "first"])
  })

  it("treats null and undefined resources as no-ops", async () => {
    const disposer = try$.disposer()
    const missing = undefined

    expect(disposer.use(null)).toBeNull()
    disposer.use(missing)

    await expect(disposer.dispose()).resolves.toBeUndefined()
  })

  it("throws TypeError when use() receives a non-disposable object", () => {
    const disposer = try$.disposer()

    expect(() => {
      disposer.use({ value: 1 } as never)
    }).toThrow(new TypeError("Object not disposable"))
  })

  it("throws TypeError when defer() receives a non-function", async () => {
    const calls: string[] = []
    const disposer = try$.disposer()

    disposer.defer(() => {
      calls.push("valid")
    })

    expect(() => {
      disposer.defer(123 as never)
    }).toThrow(new TypeError("123 is not a function"))

    await disposer.dispose()

    expect(calls).toEqual(["valid"])
  })

  it("produces a suppressed error chain when multiple cleanups fail", async () => {
    const first = new Error("first")
    const second = new Error("second")
    const disposer = try$.disposer()

    disposer.defer(() => {
      throw first
    })

    disposer.defer(() => {
      throw second
    })

    try {
      await disposer.dispose()
      expect.unreachable("should have thrown")
    } catch (error) {
      // Node 22 has no native SuppressedError, so check the shape instead of the class.
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).name).toBe("SuppressedError")
      expect((error as Error & { error: unknown }).error).toBe(first)
      expect((error as Error & { suppressed: unknown }).suppressed).toBe(second)
    }
  })

  it("continues cleanup when suppressed error fallback receives a frozen error", async () => {
    const originalSuppressedError = Reflect.get(globalThis, "SuppressedError")
    const second = Object.freeze(new Error("second"))
    const third = new Error("third")
    const calls: string[] = []
    const disposer = try$.disposer()

    Reflect.set(globalThis, "SuppressedError", undefined)

    disposer.defer(() => {
      calls.push("first")
    })

    disposer.defer(() => {
      calls.push("second")
      // oxlint-disable-next-line typescript/only-throw-error -- Intentional coverage for frozen Error disposal failures.
      throw second
    })

    disposer.defer(() => {
      calls.push("third")
      throw third
    })

    try {
      await disposer.dispose()
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).constructor).not.toBe(originalSuppressedError)
      expect((error as Error).name).toBe("SuppressedError")
      expect((error as Error & { error: unknown }).error).toBe(second)
      expect((error as Error & { suppressed: unknown }).suppressed).toBe(third)
    } finally {
      Reflect.set(globalThis, "SuppressedError", originalSuppressedError)
    }

    expect(calls).toEqual(["third", "second", "first"])
  })
})
