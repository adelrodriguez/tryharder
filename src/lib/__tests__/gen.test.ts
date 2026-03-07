import { describe, expect, it } from "bun:test"
import { CancellationError, Panic, TimeoutError } from "../errors"
import { driveGen } from "../gen"

class UserNotFound extends Error {}
class ProjectNotFound extends Error {}

describe("driveGen", () => {
  it("returns sync success value when all yielded values are sync", () => {
    const result = driveGen(function* (use) {
      const a = yield* use(20)
      const b = yield* use(22)
      return a + b
    })

    expect(result).toBe(42)
  })

  it("short-circuits sync execution on yielded Error", () => {
    let didRunAfterError = false

    const maybeUser = new UserNotFound("missing") as number | UserNotFound

    const result = driveGen(function* (use) {
      const user = yield* use(maybeUser)
      void user
      didRunAfterError = true
      return 42
    })

    expect(result).toBeInstanceOf(UserNotFound)
    expect(didRunAfterError).toBe(false)
  })

  it("awaits yielded promises and returns async success", async () => {
    const result = await driveGen(function* (use) {
      const a = yield* use(Promise.resolve(20))
      if (a > 20) {
        return new Error("boom")
      }

      const b = yield* use(Promise.resolve(22))
      return a + b
    })

    expect(result).toBe(42)
  })

  it("short-circuits async execution on resolved Error", async () => {
    let didRunAfterError = false

    const maybeProject = Promise.resolve(new ProjectNotFound("missing") as number | ProjectNotFound)

    const result = await driveGen(function* (use) {
      const project = yield* use(maybeProject)
      void project
      didRunAfterError = true
      return 42
    })

    expect(result).toBeInstanceOf(ProjectNotFound)
    expect(didRunAfterError).toBe(false)
  })

  it("rejects with the original reason when a yielded promise rejects", async () => {
    try {
      await driveGen(function* (use) {
        const value = yield* use(Promise.reject<unknown>(new Error("boom")))
        return value
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("boom")
    }
  })

  it("preserves TimeoutError from a rejected yielded promise", async () => {
    const timeout = new TimeoutError("timed out")

    try {
      await driveGen(function* (use) {
        const value = yield* use(Promise.reject<unknown>(timeout))
        return value
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(timeout)
    }
  })

  it("runs finally blocks when the first yielded promise rejects", async () => {
    let finalized = false

    try {
      await driveGen(function* (use) {
        try {
          yield* use(Promise.reject<unknown>(new Error("boom")))
        } finally {
          finalized = true
        }
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("boom")
    }

    expect(finalized).toBe(true)
  })

  it("lets the generator catch a rejected yielded promise and recover", async () => {
    const result = await driveGen(function* (use) {
      try {
        yield* use(Promise.reject<unknown>(new Error("boom")))
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe("boom")
        return 42
      }

      return 0
    })

    expect(result).toBe(42)
  })

  it("throws the original error when factory throws", () => {
    try {
      driveGen(() => {
        throw new Error("factory failed")
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("factory failed")
    }
  })

  it("preserves Panic when factory throws a control error", () => {
    const panic = new Panic("FLOW_NO_EXIT")

    try {
      driveGen(() => {
        throw panic
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(panic)
    }
  })

  it("throws the original error when generator body throws after yield", () => {
    try {
      driveGen(function* (use) {
        void (yield* use(1))
        throw new Error("generator failed")
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("generator failed")
    }
  })

  it("preserves Panic when generator body throws after a sync yield", () => {
    const panic = new Panic("FLOW_NO_EXIT")

    try {
      driveGen<number, number | Panic>(function* (use) {
        void (yield* use(1))
        throw panic
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(panic)
    }
  })

  it("returns explicit error values without throwing", () => {
    const result = driveGen(function* (use) {
      void (yield* use(1))
      return new ProjectNotFound("from return")
    })

    expect(result).toBeInstanceOf(ProjectNotFound)
    expect(result.message).toBe("from return")
  })

  it("returns explicit async error values without throwing", async () => {
    const result = driveGen(function* (use) {
      const value = yield* use(Promise.resolve(1))
      void value
      return Promise.resolve(new ProjectNotFound("async return"))
    })

    const resolved = await result

    expect(resolved).toBeInstanceOf(ProjectNotFound)
    expect(resolved.message).toBe("async return")
  })

  it("throws raw non-Error values without wrapping", () => {
    try {
      driveGen(() => {
        throw "string error"
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe("string error")
    }
  })

  it("rejects with the original error when the generator throws after entering async path", async () => {
    try {
      await driveGen(function* (use) {
        void (yield* use(Promise.resolve(1)))
        throw new Error("async throw")
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("async throw")
    }
  })

  it("preserves CancellationError when generator throws after entering async path", async () => {
    const cancellation = new CancellationError("cancelled")

    try {
      await driveGen<Promise<number>, Promise<number | CancellationError>>(function* (use) {
        void (yield* use(Promise.resolve(1)))
        throw cancellation
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(cancellation)
    }
  })

  it("rejects with the original error when the final returned promise rejects", async () => {
    try {
      await driveGen(function* (use) {
        void (yield* use(Promise.resolve(1)))
        return Promise.reject(new Error("final reject"))
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("final reject")
    }
  })

  it("preserves TimeoutError from a rejected final returned promise in async path", async () => {
    const timeout = new TimeoutError("timed out")

    try {
      await driveGen<Promise<number>, Promise<number | TimeoutError>>(function* (use) {
        void (yield* use(Promise.resolve(1)))
        return Promise.reject(timeout)
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(timeout)
    }
  })

  it("rejects with the original reason when a later async yield rejects", async () => {
    try {
      await driveGen(function* (use) {
        void (yield* use(Promise.resolve(1)))
        const value = yield* use(Promise.reject<unknown>(new Error("second reject")))
        return value
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("second reject")
    }
  })

  it("runs finally blocks when a later async yield rejects", async () => {
    let finalized = false

    try {
      await driveGen(function* (use) {
        void (yield* use(Promise.resolve(1)))

        try {
          yield* use(Promise.reject<unknown>(new Error("second reject")))
        } finally {
          finalized = true
        }
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("second reject")
    }

    expect(finalized).toBe(true)
  })

  it("handles sync yield after entering async path", async () => {
    const result = await driveGen(function* (use) {
      const a = yield* use(Promise.resolve(10))
      const b = yield* use(32 as number)
      return a + b
    })

    expect(result).toBe(42)
  })

  it("short-circuits on sync Error yielded after entering async path", async () => {
    let didRunAfterError = false

    const result = await driveGen(function* (use) {
      void (yield* use(Promise.resolve(1)))
      const value = yield* use(new UserNotFound("sync error in async") as number | UserNotFound)
      void value
      didRunAfterError = true
      return 42
    })

    expect(result).toBeInstanceOf(UserNotFound)
    expect(didRunAfterError).toBe(false)
  })

  it("resolves sync yields with a promise return value", async () => {
    const result = driveGen(function* (use) {
      const a = yield* use(20)
      const b = yield* use(22)
      return Promise.resolve(a + b)
    })

    expect(result).toBeInstanceOf(Promise)
    expect(await result).toBe(42)
  })
})
