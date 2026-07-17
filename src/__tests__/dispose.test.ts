import { describe, expect, it } from "bun:test"
import * as try$ from "../index"

describe("disposer", () => {
  it("is exposed from the root namespace", () => {
    expect(typeof try$.disposer).toBe("function")
  })

  it("returns a disposer with defer, use, and dispose only", () => {
    const disposer = try$.disposer()

    expect(typeof disposer.defer).toBe("function")
    expect(typeof disposer.use).toBe("function")
    expect(typeof disposer.dispose).toBe("function")
    expect("add" in disposer).toBe(false)
    expect("cleanup" in disposer).toBe(false)
    expect("disposeAsync" in disposer).toBe(false)
  })

  it("disposes registered cleanups in reverse order", async () => {
    const calls: string[] = []
    const disposer = try$.disposer()

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

    await disposer.dispose()

    expect(calls).toEqual(["defer:last", "use:resource", "defer:first"])
  })

  it("continues cleanup when one deferred cleanup throws", async () => {
    const calls: string[] = []
    const disposer = try$.disposer()

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
      await disposer.dispose()
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("cleanup failed")
    }

    expect(calls).toEqual(["third", "second", "first"])
  })

  it("supports sync disposable resources", async () => {
    const calls: string[] = []
    const disposer = try$.disposer()

    disposer.use({
      [Symbol.dispose]() {
        calls.push("sync")
      },
    })

    await disposer.dispose()

    expect(calls).toEqual(["sync"])
  })

  it("supports mixed sync and async cleanup resources", async () => {
    const calls: string[] = []
    const disposer = try$.disposer()

    disposer.use({
      [Symbol.dispose]() {
        calls.push("sync")
      },
    })

    disposer.use({
      async [Symbol.asyncDispose]() {
        await Promise.resolve()
        calls.push("async")
      },
    })

    await disposer.dispose()

    expect(calls).toEqual(["async", "sync"])
  })

  it("treats null and undefined resources as no-ops", async () => {
    const disposer = try$.disposer()
    const missing = undefined

    expect(disposer.use(null)).toBeNull()
    disposer.use(missing)

    await disposer.dispose()
  })

  it("throws TypeError when use() receives a non-disposable object", () => {
    const disposer = try$.disposer()

    expect(() => {
      disposer.use({ value: 1 } as never)
    }).toThrow("Object not disposable")
  })

  it("throws TypeError when defer() receives a non-function", async () => {
    const calls: string[] = []
    const disposer = try$.disposer()

    disposer.defer(() => {
      calls.push("valid")
    })

    expect(() => {
      disposer.defer(123 as never)
    }).toThrow(TypeError)

    await disposer.dispose()

    expect(calls).toEqual(["valid"])
  })

  it("produces a suppressed error chain when multiple cleanups fail", async () => {
    const disposer = try$.disposer()

    disposer.defer(() => {
      throw new Error("first")
    })

    disposer.defer(() => {
      throw new Error("second")
    })

    try {
      await disposer.dispose()
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).name).toBe("SuppressedError")
      expect((error as Error & { error: unknown }).error).toBeInstanceOf(Error)
      expect((error as Error & { error: Error }).error.message).toBe("first")
      expect((error as Error & { suppressed: unknown }).suppressed).toBeInstanceOf(Error)
      expect((error as Error & { suppressed: Error }).suppressed.message).toBe("second")
    }
  })

  it("continues cleanup when suppressed error fallback receives a frozen error", async () => {
    const originalSuppressedError = Reflect.get(globalThis, "SuppressedError")
    const calls: string[] = []
    const disposer = try$.disposer()

    Reflect.set(globalThis, "SuppressedError", undefined)

    disposer.defer(() => {
      calls.push("first")
    })

    disposer.defer(() => {
      calls.push("second")
      // oxlint-disable-next-line typescript/only-throw-error -- Intentional coverage for frozen Error disposal failures.
      throw Object.freeze(new Error("second"))
    })

    disposer.defer(() => {
      calls.push("third")
      throw new Error("third")
    })

    try {
      await disposer.dispose()
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).name).toBe("SuppressedError")
      expect((error as Error & { error: unknown }).error).toBeInstanceOf(Error)
      expect((error as Error & { error: Error }).error.message).toBe("second")
      expect((error as Error & { suppressed: unknown }).suppressed).toBeInstanceOf(Error)
      expect((error as Error & { suppressed: Error }).suppressed.message).toBe("third")
    } finally {
      Reflect.set(globalThis, "SuppressedError", originalSuppressedError)
    }

    expect(calls).toEqual(["third", "second", "first"])
  })
})
