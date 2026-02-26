import { describe, expect, it } from "bun:test"
import { executeGen } from "../gen"

class UserNotFound extends Error {}
class ProjectNotFound extends Error {}

describe("executeGen", () => {
  it("returns sync success value when all yielded values are sync", () => {
    const result = executeGen(function* (use) {
      const a = yield* use(20)
      const b = yield* use(22)
      return a + b
    })

    expect(result).toBe(42)
  })

  it("short-circuits sync execution on yielded Error", () => {
    let didRunAfterError = false

    const maybeUser = new UserNotFound("missing") as number | UserNotFound

    const result = executeGen(function* (use) {
      const user = yield* use(maybeUser)
      void user
      didRunAfterError = true
      return 42
    })

    expect(result).toBeInstanceOf(UserNotFound)
    expect(didRunAfterError).toBe(false)
  })

  it("awaits yielded promises and returns async success", async () => {
    const result = executeGen(function* (use) {
      const a = yield* use(Promise.resolve(20))
      const b = yield* use(Promise.resolve(22))
      return a + b
    })

    expect(await result).toBe(42)
  })

  it("short-circuits async execution on resolved Error", async () => {
    let didRunAfterError = false

    const maybeProject = Promise.resolve(new ProjectNotFound("missing") as number | ProjectNotFound)

    const result = executeGen(function* (use) {
      const project = yield* use(maybeProject)
      void project
      didRunAfterError = true
      return 42
    })

    expect(await result).toBeInstanceOf(ProjectNotFound)
    expect(didRunAfterError).toBe(false)
  })

  it("propagates rejected yielded promise", async () => {
    const result = executeGen(function* (use) {
      const value = yield* use(Promise.reject<unknown>(new Error("boom")))
      return value
    })

    try {
      await Promise.resolve(result)
      throw new Error("Expected rejection")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("boom")
    }
  })
})
