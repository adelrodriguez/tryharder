import { describe, expect, it } from "bun:test"
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
    const result = try$.gen(function* (use) {
      const a = yield* use(20)
      const b = yield* use(22)
      return a + b
    })

    expect(result).toBe(42)
  })

  it("short-circuits sync execution on yielded Error", () => {
    let didRunAfterError = false

    const maybeUser = new UserNotFoundError("missing") as number | UserNotFoundError

    const result = try$.gen(function* (use) {
      const user = yield* use(maybeUser)
      void user
      didRunAfterError = true
      return 42
    })

    expect(result).toBeInstanceOf(UserNotFoundError)
    expect(didRunAfterError).toBe(false)
  })

  it("awaits yielded promises and returns async success", async () => {
    const result = await try$.gen(function* (use) {
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

    const maybeProject = Promise.resolve(
      new ProjectNotFoundError("missing") as number | ProjectNotFoundError
    )

    const result = await try$.gen(function* (use) {
      const project = yield* use(maybeProject)
      void project
      didRunAfterError = true
      return 42
    })

    expect(result).toBeInstanceOf(ProjectNotFoundError)
    expect(didRunAfterError).toBe(false)
  })

  it("rejects with the original reason when a yielded promise rejects", async () => {
    try {
      await try$.gen(function* (use) {
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
      await try$.gen(function* (use) {
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
      await try$.gen(function* (use) {
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
    const result = await try$.gen(function* (use) {
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
      try$.gen(() => {
        throw new Error("factory failed")
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("factory failed")
    }
  })

  it("preserves Panic when factory throws Panic", () => {
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

  it("throws the original error when generator body throws after yield", () => {
    try {
      try$.gen(function* (use) {
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
    const result = try$.gen(function* (use) {
      void (yield* use(1))
      return new ProjectNotFoundError("from return")
    })

    expect(result).toBeInstanceOf(ProjectNotFoundError)
    expect(result.message).toBe("from return")
  })

  it("returns explicit async error values without throwing", async () => {
    const result = try$.gen(function* (use) {
      const value = yield* use(Promise.resolve(1))
      void value
      return Promise.resolve(new ProjectNotFoundError("async return"))
    })

    const resolved = await result

    expect(resolved).toBeInstanceOf(ProjectNotFoundError)
    expect(resolved.message).toBe("async return")
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
    try {
      await try$.gen(function* (use) {
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
    try {
      await try$.gen(function* (use) {
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
      await try$.gen<Promise<number>, Promise<number | TimeoutError>>(function* (use) {
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
      await try$.gen(function* (use) {
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
      await try$.gen(function* (use) {
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
    const result = await try$.gen(function* (use) {
      const a = yield* use(Promise.resolve(10))
      const b = yield* use(32)
      return a + b
    })

    expect(result).toBe(42)
  })

  it("short-circuits on sync Error yielded after entering async path", async () => {
    let didRunAfterError = false

    const result = await try$.gen(function* (use) {
      void (yield* use(Promise.resolve(1)))
      const value = yield* use(
        new UserNotFoundError("sync error in async") as number | UserNotFoundError
      )
      void value
      didRunAfterError = true
      return 42
    })

    expect(result).toBeInstanceOf(UserNotFoundError)
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
    const result = try$.gen(function* (use) {
      const value = yield* use(
        try$.runSync((): number => {
          throw new Error("boom")
        })
      )

      return value
    })

    expect(result).toBeInstanceOf(UnhandledException)
  })

  it("short-circuits with error from try$.run inside gen", async () => {
    const result = await try$.gen(function* (use) {
      const value = yield* use(
        try$.run(async (): Promise<number> => {
          await Promise.resolve()
          throw new Error("boom")
        })
      )

      return value
    })

    expect(result).toBeInstanceOf(UnhandledException)
  })

  it("composes multiple try$ calls and returns success or mapped errors", async () => {
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

      const getProject = (userId: string) =>
        try$.run({
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

      return try$.gen(function* (use) {
        const user = yield* use(getUser())
        const project = yield* use(getProject(user.id))
        return `${user.id}:${project.id}`
      })
    }

    const ok = await runFlow("ok")
    const userNotFound = await runFlow("user-not-found")
    const permissionDenied = await runFlow("permission-denied")
    const projectNotFound = await runFlow("project-not-found")

    expect(ok).toBe("u_1:p_u_1")
    expect(userNotFound).toBeInstanceOf(UserNotFoundInFlowError)
    expect(permissionDenied).toBeInstanceOf(PermissionDeniedError)
    expect(projectNotFound).toBeInstanceOf(ProjectNotFoundInFlowError)
  })
})
