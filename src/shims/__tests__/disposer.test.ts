import { describe, expect, it } from "vitest"
import {
  ASYNC_DISPOSE,
  type AsyncDisposableLike,
  createAsyncDisposer,
  defineAsyncDisposeAlias,
  defineDisposeAlias,
  DISPOSE,
  type DisposableLike,
  InternalDisposableStack,
} from "../disposer"

type SuppressedErrorLike = Error & { error: unknown; suppressed: unknown }

function catchError(fn: () => void): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }

  return expect.unreachable("should have thrown")
}

describe("disposer shim", () => {
  it("uses the native disposal symbols when the runtime provides them", () => {
    expect(DISPOSE).toBe(Symbol.dispose)
    expect(ASYNC_DISPOSE).toBe(Symbol.asyncDispose)
  })

  it("installs a non-enumerable sync dispose alias that calls the instance dispose method", () => {
    class SyncAliasTarget {
      calls: string[] = []

      dispose(): void {
        this.calls.push("prototype")
      }
    }

    defineDisposeAlias(SyncAliasTarget.prototype)

    const instance = new SyncAliasTarget() as SyncAliasTarget & Disposable
    instance.dispose = () => {
      instance.calls.push("own")
    }

    instance[Symbol.dispose]()

    expect(instance.calls).toEqual(["own"])
    expect(Object.getOwnPropertyDescriptor(SyncAliasTarget.prototype, DISPOSE)).toMatchObject({
      configurable: true,
      enumerable: false,
      writable: true,
    })
  })

  it("installs a non-enumerable async dispose alias that awaits the instance dispose method", async () => {
    class AsyncAliasTarget {
      disposed = 0

      async dispose(): Promise<void> {
        await Promise.resolve()
        this.disposed += 1
      }
    }

    defineAsyncDisposeAlias(AsyncAliasTarget.prototype)

    const instance = new AsyncAliasTarget() as AsyncAliasTarget & AsyncDisposable
    const pending = instance[Symbol.asyncDispose]()

    expect(instance.disposed).toBe(0)

    await pending

    expect(instance.disposed).toBe(1)
    expect(
      Object.getOwnPropertyDescriptor(AsyncAliasTarget.prototype, ASYNC_DISPOSE)
    ).toMatchObject({
      configurable: true,
      enumerable: false,
      writable: true,
    })
  })

  describe("InternalDisposableStack", () => {
    it("runs deferred cleanups in LIFO order through the sync symbol alias", () => {
      const calls: string[] = []
      const stack = new InternalDisposableStack()

      stack.defer(() => {
        calls.push("first")
      })

      stack.defer(() => {
        calls.push("second")
      })

      stack[Symbol.dispose]()

      expect(calls).toEqual(["second", "first"])
    })

    it("returns used resources and disposes them only when the stack is disposed", () => {
      const calls: string[] = []
      const stack = new InternalDisposableStack()
      const missing = undefined

      const resource: DisposableLike = {
        [DISPOSE]() {
          calls.push("resource")
        },
      }

      expect(stack.use(resource)).toBe(resource)
      expect(stack.use(null)).toBeNull()
      stack.use(missing)
      expect(calls).toEqual([])

      stack.dispose()

      expect(calls).toEqual(["resource"])
    })

    it("runs cleanups once when disposed more than once", () => {
      let cleanupCalls = 0
      const stack = new InternalDisposableStack()

      stack.defer(() => {
        cleanupCalls += 1
      })

      stack.dispose()
      stack.dispose()

      expect(cleanupCalls).toBe(1)
    })

    it("throws a TypeError for non-disposable resources and non-function cleanups", () => {
      const stack = new InternalDisposableStack()

      expect(() => {
        stack.use({} as never)
      }).toThrow(new TypeError("Object not disposable"))
      expect(() => {
        stack.defer(123 as never)
      }).toThrow(new TypeError("123 is not a function"))
    })

    it("rethrows a single cleanup failure as the raw thrown value", () => {
      const calls: string[] = []
      const stack = new InternalDisposableStack()

      stack.defer(() => {
        calls.push("first")
      })

      stack.defer(() => {
        calls.push("second")
        // oxlint-disable-next-line no-throw-literal, typescript/only-throw-error -- Verify raw non-Error failures are preserved.
        throw "raw failure"
      })

      expect(
        catchError(() => {
          stack.dispose()
        })
      ).toBe("raw failure")
      expect(calls).toEqual(["second", "first"])
    })

    it("nests multiple cleanup failures as SuppressedError chains in disposal order", () => {
      const calls: string[] = []
      const stack = new InternalDisposableStack()
      const firstError = new Error("first")
      const secondError = new Error("second")
      const thirdError = new Error("third")

      stack.defer(() => {
        calls.push("first")
        throw firstError
      })

      stack.defer(() => {
        calls.push("second")
        throw secondError
      })

      stack.defer(() => {
        calls.push("third")
        throw thirdError
      })

      const error = catchError(() => {
        stack.dispose()
      }) as SuppressedErrorLike

      expect(calls).toEqual(["third", "second", "first"])
      expect(error.name).toBe("SuppressedError")
      expect(error.error).toBe(firstError)

      const inner = error.suppressed as SuppressedErrorLike

      expect(inner.name).toBe("SuppressedError")
      expect(inner.error).toBe(secondError)
      expect(inner.suppressed).toBe(thirdError)
    })

    it("fails fast before reading a sync disposer from an already disposed stack", () => {
      const stack = new InternalDisposableStack()
      let getterCalls = 0
      const resource = {}

      Object.defineProperty(resource, DISPOSE, {
        get() {
          getterCalls += 1
          return () => null
        },
      })

      stack.dispose()

      expect(() => {
        stack.use(resource as unknown as Disposable)
      }).toThrow(new ReferenceError("DisposableStack already disposed"))
      expect(() => {
        stack.defer(() => null)
      }).toThrow(new ReferenceError("DisposableStack already disposed"))
      expect(getterCalls).toBe(0)
    })
  })

  describe("createAsyncDisposer", () => {
    it("runs deferred cleanups through the async symbol alias", async () => {
      const calls: string[] = []
      const disposer = createAsyncDisposer()

      disposer.defer(() => {
        calls.push("cleanup")
      })

      await disposer[Symbol.asyncDispose]()

      expect(calls).toEqual(["cleanup"])
    })

    it("runs cleanups once when disposed more than once", async () => {
      let cleanupCalls = 0
      const disposer = createAsyncDisposer()

      disposer.defer(() => {
        cleanupCalls += 1
      })

      await disposer.dispose()
      await disposer.dispose()

      expect(cleanupCalls).toBe(1)
    })

    it("prefers the async dispose method over the sync one on the same resource", async () => {
      const calls: string[] = []
      const disposer = createAsyncDisposer()

      const resource: AsyncDisposableLike & DisposableLike = {
        async [ASYNC_DISPOSE]() {
          await Promise.resolve()
          calls.push("async")
        },
        [DISPOSE]() {
          calls.push("sync")
        },
      }

      disposer.use(resource as unknown as AsyncDisposable)

      await disposer.dispose()

      expect(calls).toEqual(["async"])
    })

    it("fails fast before reading an async disposer from an already disposed async stack", async () => {
      const disposer = createAsyncDisposer()
      let getterCalls = 0
      const resource = {}

      Object.defineProperty(resource, ASYNC_DISPOSE, {
        get() {
          getterCalls += 1
          return async () => {
            await Promise.resolve()
          }
        },
      })

      await disposer.dispose()

      expect(() => {
        disposer.use(resource as unknown as AsyncDisposable)
      }).toThrow(new ReferenceError("AsyncDisposableStack already disposed"))
      expect(() => {
        disposer.defer(async () => {
          await Promise.resolve()
        })
      }).toThrow(new ReferenceError("AsyncDisposableStack already disposed"))
      expect(getterCalls).toBe(0)
    })
  })
})
