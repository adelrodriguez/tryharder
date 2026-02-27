import { describe, expect, it } from "bun:test"
import { UnhandledException } from "../../errors"
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
    const result = await executeGen(function* (use) {
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

    const result = await executeGen(function* (use) {
      const project = yield* use(maybeProject)
      void project
      didRunAfterError = true
      return 42
    })

    expect(result).toBeInstanceOf(ProjectNotFound)
    expect(didRunAfterError).toBe(false)
  })

  it("propagates rejected yielded promise", async () => {
    const result = await executeGen(function* (use) {
      const value = yield* use(Promise.reject<unknown>(new Error("boom")))
      return value
    })

    expect(result).toBeInstanceOf(UnhandledException)
    expect((result as UnhandledException).cause).toBeInstanceOf(Error)
    expect(((result as UnhandledException).cause as Error).message).toBe("boom")
  })

  it("returns error when factory throws", () => {
    const result = executeGen(() => {
      throw new Error("factory failed")
    })

    expect(result).toBeInstanceOf(UnhandledException)
    expect((result as UnhandledException).cause).toBeInstanceOf(Error)
    expect(((result as UnhandledException).cause as Error).message).toBe("factory failed")
  })

  it("returns error when generator body throws after yield", () => {
    const result = executeGen(function* (use) {
      void (yield* use(1))
      throw new Error("generator failed")
    })

    expect(result).toBeInstanceOf(UnhandledException)
    expect((result as UnhandledException).cause).toBeInstanceOf(Error)
    expect(((result as UnhandledException).cause as Error).message).toBe("generator failed")
  })

  it("returns explicit error values without throwing", () => {
    const result = executeGen(function* (use) {
      void (yield* use(1))
      return new ProjectNotFound("from return")
    })

    expect(result).toBeInstanceOf(ProjectNotFound)
    expect(result.message).toBe("from return")
  })

  it("returns explicit async error values without throwing", async () => {
    const result = executeGen(function* (use) {
      const value = yield* use(Promise.resolve(1))
      void value
      return Promise.resolve(new ProjectNotFound("async return"))
    })

    const resolved = await result

    expect(resolved).toBeInstanceOf(ProjectNotFound)
    expect(resolved.message).toBe("async return")
  })

  it("wraps non-Error thrown value in UnhandledException", () => {
    const result = executeGen(() => {
      throw "string error"
    })

    expect(result).toBeInstanceOf(UnhandledException)
    expect((result as UnhandledException).cause).toBe("string error")
  })

  it("wraps thrown error in UnhandledException in async path when generator throws after yield", async () => {
    const result = await executeGen(function* (use) {
      void (yield* use(Promise.resolve(1)))
      throw new Error("async throw")
    })

    expect(result).toBeInstanceOf(UnhandledException)
    expect((result as UnhandledException).cause).toBeInstanceOf(Error)
  })

  it("wraps rejection of final returned promise in async path", async () => {
    const result = await executeGen(function* (use) {
      void (yield* use(Promise.resolve(1)))
      return Promise.reject(new Error("final reject"))
    })

    expect(result).toBeInstanceOf(UnhandledException)
    expect((result as UnhandledException).cause).toBeInstanceOf(Error)
  })

  it("wraps rejection of second async yield", async () => {
    const result = await executeGen(function* (use) {
      void (yield* use(Promise.resolve(1)))
      const value = yield* use(Promise.reject<unknown>(new Error("second reject")))
      return value
    })

    expect(result).toBeInstanceOf(UnhandledException)
    expect((result as UnhandledException).cause).toBeInstanceOf(Error)
  })

  it("handles sync yield after entering async path", async () => {
    const result = await executeGen(function* (use) {
      const a = yield* use(Promise.resolve(10))
      const b = yield* use(32 as number)
      return a + b
    })

    expect(result).toBe(42)
  })

  it("short-circuits on sync Error yielded after entering async path", async () => {
    let didRunAfterError = false

    const result = await executeGen(function* (use) {
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
    const result = executeGen(function* (use) {
      const a = yield* use(20)
      const b = yield* use(22)
      return Promise.resolve(a + b)
    })

    expect(result).toBeInstanceOf(Promise)
    expect(await result).toBe(42)
  })
})
