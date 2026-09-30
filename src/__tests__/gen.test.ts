import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { CancellationError, Panic, TimeoutError, UnhandledException } from "../errors"
import * as try$ from "../index"

class UserNotFoundError extends Error {
  override name = "UserNotFoundError"
}

class ProjectNotFoundError extends Error {
  override name = "ProjectNotFoundError"
}

describe("gen", () => {
  it("returns sync success value when all yielded values are sync", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (values) => {
        const observed: number[] = []

        const result = try$.gen(function* (use) {
          for (const value of values) {
            observed.push(yield* use(value))
          }

          return observed.reduce((sum, value) => sum + value, 0)
        })

        expect(result).toBe(values.reduce((sum, value) => sum + value, 0))
        expect(observed).toEqual(values)
      })
    )
  })

  it("short-circuits sync execution on yielded Error", () => {
    let didRunAfterError = false

    const userError = new UserNotFoundError("missing")
    const maybeUser = userError as number | UserNotFoundError

    const result = try$.gen(function* (use) {
      const user = yield* use(maybeUser)
      void user
      didRunAfterError = true
      return 42
    })

    expect(result).toBe(userError)
    expect(didRunAfterError).toBe(false)
  })

  it("runs finally blocks when sync execution short-circuits on a yielded Error", () => {
    const events: string[] = []
    const userError = new UserNotFoundError("missing")

    const result = try$.gen(function* (use) {
      try {
        yield* use(userError as number | UserNotFoundError)
        events.push("after")
        return 42
      } finally {
        events.push("finally")
      }
    })

    expect(result).toBe(userError)
    expect(events).toEqual(["finally"])
  })

  it("awaits yielded promises and returns async success", async () => {
    const result = await try$.gen(function* (use) {
      const a = yield* use(Promise.resolve(20))
      const b = yield* use(Promise.resolve(22))
      return a + b
    })

    expect(result).toBe(42)
  })

  it("short-circuits async execution on resolved Error", async () => {
    let didRunAfterError = false

    const projectError = new ProjectNotFoundError("missing")
    const maybeProject = Promise.resolve(projectError as number | ProjectNotFoundError)

    const result = await try$.gen(function* (use) {
      const project = yield* use(maybeProject)
      void project
      didRunAfterError = true
      return 42
    })

    expect(result).toBe(projectError)
    expect(didRunAfterError).toBe(false)
  })

  it("runs finally blocks when async execution short-circuits on a resolved Error", async () => {
    const events: string[] = []
    const projectError = new ProjectNotFoundError("missing")

    const result = await try$.gen(function* (use) {
      try {
        yield* use(Promise.resolve(projectError as number | ProjectNotFoundError))
        events.push("after")
        return 42
      } finally {
        events.push("finally")
      }
    })

    expect(result).toBe(projectError)
    expect(events).toEqual(["finally"])
  })

  it("completes a finally block that yields a promise after an async short-circuit", async () => {
    const events: string[] = []
    const projectError = new ProjectNotFoundError("missing")

    const result = await try$.gen(function* (use) {
      try {
        yield* use(Promise.resolve(projectError as number | ProjectNotFoundError))
        return 42
      } finally {
        events.push(`cleanup:${String(yield* use(Promise.resolve(1)))}`)
      }
    })

    expect(result).toBe(projectError)
    expect(events).toEqual(["cleanup:1"])
  })

  it("rejects with the cleanup failure when a finally block yields a rejected promise", async () => {
    const projectError = new ProjectNotFoundError("missing")
    const cleanupFailure = new Error("cleanup failed")

    await expect(
      try$.gen(function* (use) {
        try {
          yield* use(Promise.resolve(projectError as number | ProjectNotFoundError))
          return 42
        } finally {
          yield* use(Promise.reject<number>(cleanupFailure))
        }
      })
    ).rejects.toBe(cleanupFailure)
  })

  it("stays sync when a finally block yields a sync value after a sync short-circuit", () => {
    const events: string[] = []
    const userError = new UserNotFoundError("missing")

    const result = try$.gen(function* (use) {
      try {
        yield* use(userError as number | UserNotFoundError)
        return 42
      } finally {
        events.push(`cleanup:${String(yield* use(1))}`)
      }
    })

    expect(result).toBe(userError)
    expect(events).toEqual(["cleanup:1"])
  })

  it("completes a finally block that yields a promise after a sync short-circuit", async () => {
    const events: string[] = []
    const userError = new UserNotFoundError("missing")

    const result = try$.gen(function* (use) {
      try {
        yield* use(userError as number | UserNotFoundError)
        return 42
      } finally {
        events.push(`cleanup:${String(yield* use(Promise.resolve(1)))}`)
      }
    })

    expect(events).toEqual([])
    expect(await result).toBe(userError)
    expect(events).toEqual(["cleanup:1"])
  })

  it("rejects with the original reason and runs finally blocks when the first yielded promise rejects", async () => {
    const failure = new TimeoutError("timed out")
    let finalized = false

    try {
      await try$.gen(function* (use) {
        try {
          yield* use(Promise.reject<unknown>(failure))
        } finally {
          finalized = true
        }
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(failure)
    }

    expect(finalized).toBe(true)
  })

  it("lets the generator catch a rejected yielded promise and recover", async () => {
    const failure = new Error("boom")
    let caught: unknown

    const result = await try$.gen(function* (use) {
      try {
        yield* use(Promise.reject<unknown>(failure))
      } catch (error) {
        caught = error
        return 42
      }

      return 0
    })

    expect(result).toBe(42)
    expect(caught).toBe(failure)
  })

  it("throws the original error when factory throws", () => {
    const panic = new Panic("FLOW_NO_EXIT")

    try {
      try$.gen(() => {
        throw panic
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(panic)
    }
  })

  it("throws the original error when generator body throws after a sync yield", () => {
    const panic = new Panic("FLOW_NO_EXIT")

    try {
      try$.gen<number, number | Panic>(function* (use) {
        void (yield* use(1))
        throw panic
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(panic)
    }
  })

  it("returns explicit error values without throwing", () => {
    const projectError = new ProjectNotFoundError("from return")

    const result = try$.gen(function* (use) {
      void (yield* use(1))
      return projectError
    })

    expect(result).toBe(projectError)
  })

  it("returns explicit async error values without throwing", async () => {
    const projectError = new ProjectNotFoundError("async return")

    const result = try$.gen(function* (use) {
      const value = yield* use(Promise.resolve(1))
      void value
      return Promise.resolve(projectError)
    })

    expect(result).toBeInstanceOf(Promise)
    expect(await result).toBe(projectError)
  })

  it("throws raw non-Error values without wrapping", () => {
    try {
      try$.gen(() => {
        // oxlint-disable-next-line no-throw-literal, typescript/only-throw-error -- Intentional coverage for raw non-Error generator failures.
        throw "string error"
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe("string error")
    }
  })

  it("rejects with the original error when the generator throws after entering async path", async () => {
    const cancellation = new CancellationError("cancelled")

    try {
      await try$.gen<Promise<number>, Promise<number | CancellationError>>(function* (use) {
        void (yield* use(Promise.resolve(1)))
        throw cancellation
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(cancellation)
    }
  })

  it("rejects with the original error when the final returned promise rejects", async () => {
    const timeout = new TimeoutError("timed out")

    try {
      await try$.gen<Promise<number>, Promise<number | TimeoutError>>(function* (use) {
        void (yield* use(Promise.resolve(1)))
        return Promise.reject(timeout)
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(timeout)
    }
  })

  it("rejects with the original reason and runs finally blocks when a later async yield rejects", async () => {
    const failure = new Error("second reject")
    let finalized = false

    try {
      await try$.gen(function* (use) {
        void (yield* use(Promise.resolve(1)))

        try {
          yield* use(Promise.reject<unknown>(failure))
        } finally {
          finalized = true
        }
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBe(failure)
    }

    expect(finalized).toBe(true)
  })

  it("handles sync yield after entering async path", async () => {
    const result = await try$.gen(function* (use) {
      const a = yield* use(Promise.resolve(10))
      const b = yield* use(32)
      return a + b
    })

    expect(result).toBe(42)
  })

  it("short-circuits on sync Error yielded after entering async path", async () => {
    let didRunAfterError = false

    const userError = new UserNotFoundError("sync error in async")

    const result = await try$.gen(function* (use) {
      void (yield* use(Promise.resolve(1)))
      const value = yield* use(userError as number | UserNotFoundError)
      void value
      didRunAfterError = true
      return 42
    })

    expect(result).toBe(userError)
    expect(didRunAfterError).toBe(false)
  })

  it("resolves sync yields with a promise return value", async () => {
    const result = try$.gen(function* (use) {
      const a = yield* use(20)
      const b = yield* use(22)
      return Promise.resolve(a + b)
    })

    expect(result).toBeInstanceOf(Promise)
    expect(await result).toBe(42)
  })
})

describe("gen composition", () => {
  class PermissionDeniedError extends Error {
    override name = "PermissionDeniedError"
  }

  class UserNotFoundInFlowError extends Error {
    override name = "UserNotFoundInFlowError"
  }

  class ProjectNotFoundInFlowError extends Error {
    override name = "ProjectNotFoundInFlowError"
  }

  it("short-circuits with error from try$.runSync inside gen", () => {
    const failure = new Error("boom")

    const result = try$.gen(function* (use) {
      const value = yield* use(
        try$.runSync((): number => {
          throw failure
        })
      )

      return value
    })

    expect(result).toBeInstanceOf(UnhandledException)
    expect((result as UnhandledException).cause).toBe(failure)
  })

  it("short-circuits with error from try$.run inside gen", async () => {
    const failure = new Error("boom")

    const result = await try$.gen(function* (use) {
      const value = yield* use(
        try$.run(async (): Promise<number> => {
          await Promise.resolve()
          throw failure
        })
      )

      return value
    })

    expect(result).toBeInstanceOf(UnhandledException)
    expect((result as UnhandledException).cause).toBe(failure)
  })

  it("composes multiple try$ calls and returns success or mapped errors", async () => {
    let projectCalls = 0

    const runFlow = (mode: "ok" | "permission-denied" | "project-not-found" | "user-not-found") => {
      const getUser = () =>
        try$.run({
          catch: (error): PermissionDeniedError | UserNotFoundInFlowError => {
            if (error instanceof TypeError) {
              return new PermissionDeniedError("denied")
            }

            return new UserNotFoundInFlowError("missing user")
          },
          try: async () => {
            await Promise.resolve()

            if (mode === "permission-denied") {
              throw new TypeError("denied")
            }

            if (mode === "user-not-found") {
              throw new Error("missing")
            }

            return { id: "u_1" }
          },
        })

      const getProject = (userId: string) => {
        projectCalls += 1

        return try$.run({
          catch: (): ProjectNotFoundInFlowError =>
            new ProjectNotFoundInFlowError("missing project"),
          try: async () => {
            await Promise.resolve()

            if (mode === "project-not-found") {
              throw new Error("missing")
            }

            return { id: `p_${userId}` }
          },
        })
      }

      return try$.gen(function* (use) {
        const user = yield* use(getUser())
        const project = yield* use(getProject(user.id))
        return `${user.id}:${project.id}`
      })
    }

    const ok = await runFlow("ok")
    const projectNotFound = await runFlow("project-not-found")

    expect(projectCalls).toBe(2)

    const userNotFound = await runFlow("user-not-found")
    const permissionDenied = await runFlow("permission-denied")

    expect(projectCalls).toBe(2)

    expect(ok).toBe("u_1:p_u_1")
    expect(userNotFound).toBeInstanceOf(UserNotFoundInFlowError)
    expect(permissionDenied).toBeInstanceOf(PermissionDeniedError)
    expect(projectNotFound).toBeInstanceOf(ProjectNotFoundInFlowError)
  })
})
