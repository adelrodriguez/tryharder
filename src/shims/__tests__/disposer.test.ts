import { describe, expect, it } from "bun:test"
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

describe("disposer shim", () => {
  it("uses runtime-compatible disposal symbols", () => {
    const nativeDispose = Reflect.get(Symbol, "dispose")
    const nativeAsyncDispose = Reflect.get(Symbol, "asyncDispose")

    expect(DISPOSE).toBe(
      typeof nativeDispose === "symbol" ? nativeDispose : Symbol.for("Symbol.dispose")
    )
    expect(ASYNC_DISPOSE).toBe(
      typeof nativeAsyncDispose === "symbol"
        ? nativeAsyncDispose
        : Symbol.for("Symbol.asyncDispose")
    )
  })

  it("installs a sync dispose alias that delegates through the instance", () => {
    class SyncAliasTarget {
      disposed = 0

      dispose(): void {
        this.disposed += 1
      }
    }

    defineDisposeAlias(SyncAliasTarget.prototype)

    const instance = new SyncAliasTarget() as SyncAliasTarget & { [DISPOSE](): void }
    const disposeAlias = instance[DISPOSE]

    expect(typeof disposeAlias).toBe("function")

    if (!disposeAlias) {
      throw new Error("missing sync dispose alias")
    }

    disposeAlias.call(instance)

    expect(instance.disposed).toBe(1)
  })

  it("installs an async dispose alias that delegates through the instance", async () => {
    class AsyncAliasTarget {
      disposed = 0

      async dispose(): Promise<void> {
        await Promise.resolve()
        this.disposed += 1
      }
    }

    defineAsyncDisposeAlias(AsyncAliasTarget.prototype)

    const instance = new AsyncAliasTarget() as AsyncAliasTarget & {
      [ASYNC_DISPOSE](): Promise<void>
    }
    const disposeAsyncAlias = instance[ASYNC_DISPOSE]

    expect(typeof disposeAsyncAlias).toBe("function")

    if (!disposeAsyncAlias) {
      throw new Error("missing async dispose alias")
    }

    await disposeAsyncAlias.call(instance)

    expect(instance.disposed).toBe(1)
  })

  it("defines configurable and writable alias descriptors", () => {
    let syncDisposeCalls = 0
    let asyncDisposeCalls = 0

    class SyncDescriptorTarget {
      disposed = 0

      dispose(): void {
        this.disposed += 1
        syncDisposeCalls += 1
      }
    }

    class AsyncDescriptorTarget {
      disposed = 0

      async dispose(): Promise<void> {
        await Promise.resolve()
        this.disposed += 1
        asyncDisposeCalls += 1
      }
    }

    defineDisposeAlias(SyncDescriptorTarget.prototype)
    defineAsyncDisposeAlias(AsyncDescriptorTarget.prototype)

    const syncDescriptor = Object.getOwnPropertyDescriptor(SyncDescriptorTarget.prototype, DISPOSE)
    const asyncDescriptor = Object.getOwnPropertyDescriptor(
      AsyncDescriptorTarget.prototype,
      ASYNC_DISPOSE
    )

    expect(syncDescriptor).toBeDefined()
    expect(syncDescriptor?.configurable).toBe(true)
    expect(syncDescriptor?.writable).toBe(true)

    expect(asyncDescriptor).toBeDefined()
    expect(asyncDescriptor?.configurable).toBe(true)
    expect(asyncDescriptor?.writable).toBe(true)

    void syncDisposeCalls
    void asyncDisposeCalls
  })

  it("exposes a callable sync symbol alias on InternalDisposableStack", () => {
    const calls: string[] = []
    const stack = new InternalDisposableStack() as InternalDisposableStack & {
      [DISPOSE](): void
    }
    const disposeAlias = stack[DISPOSE]

    stack.defer(() => {
      calls.push("first")
    })

    stack.defer(() => {
      calls.push("second")
    })

    expect(typeof disposeAlias).toBe("function")

    if (!disposeAlias) {
      throw new Error("missing stack dispose alias")
    }

    disposeAlias.call(stack)

    expect(calls).toEqual(["second", "first"])
  })

  it("accepts resources that are disposable only through the shim symbol", () => {
    const calls: string[] = []
    const stack = new InternalDisposableStack()

    const resource: DisposableLike = {
      [DISPOSE]() {
        calls.push("shim-dispose")
      },
    }

    stack.use(resource)

    stack.dispose()

    expect(calls).toEqual(["shim-dispose"])
  })

  it("exposes a callable async symbol alias on the async disposer", async () => {
    const calls: string[] = []
    const disposer = createAsyncDisposer() as ReturnType<typeof createAsyncDisposer> & {
      [ASYNC_DISPOSE](): Promise<void>
    }
    const disposeAsyncAlias = disposer[ASYNC_DISPOSE]

    disposer.defer(() => {
      calls.push("cleanup")
    })

    expect(typeof disposeAsyncAlias).toBe("function")

    if (!disposeAsyncAlias) {
      throw new Error("missing async disposer alias")
    }

    await disposeAsyncAlias.call(disposer)

    expect(calls).toEqual(["cleanup"])
  })

  it("runs deferred cleanup through dispose()", async () => {
    const calls: string[] = []
    const disposer = createAsyncDisposer()

    disposer.defer(() => {
      calls.push("cleanup")
    })

    await disposer.dispose()

    expect(calls).toEqual(["cleanup"])
  })

  it("handles async shim-symbol resources and sync shim-symbol fallback in LIFO order", async () => {
    const calls: string[] = []
    const disposer = createAsyncDisposer()

    const syncResource: DisposableLike = {
      [DISPOSE]() {
        calls.push("sync")
      },
    }

    const asyncResource: AsyncDisposableLike = {
      async [ASYNC_DISPOSE]() {
        await Promise.resolve()
        calls.push("async")
      },
    }

    disposer.use(syncResource as unknown as Disposable)
    disposer.use(asyncResource as unknown as AsyncDisposable)

    await disposer.dispose()

    expect(calls).toEqual(["async", "sync"])
  })

  it("throws a TypeError for non-disposable shim resources", () => {
    const disposer = createAsyncDisposer()

    expect(() => {
      disposer.use({} as never)
    }).toThrow("Object not disposable")
  })

  it("fails fast before reading a sync disposer from an already disposed stack", () => {
    const stack = new InternalDisposableStack()
    let getterCalls = 0
    const resource = {}

    Object.defineProperty(resource, DISPOSE, {
      get() {
        getterCalls += 1
        return () => {
          void getterCalls
        }
      },
    })

    stack.dispose()

    expect(() => {
      stack.use(resource as unknown as Disposable)
    }).toThrow("DisposableStack already disposed")
    expect(getterCalls).toBe(0)
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
          void getterCalls
        }
      },
    })

    await disposer.dispose()

    expect(() => {
      disposer.use(resource as unknown as AsyncDisposable)
    }).toThrow("AsyncDisposableStack already disposed")
    expect(getterCalls).toBe(0)
  })
})
