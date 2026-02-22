import { describe, expect, it } from "bun:test"
import { Panic, RetryExhaustedError, UnhandledException, retry, run } from "../index"

class InvalidInputError extends Error {}
class PermissionDeniedError extends Error {}
class NetworkError extends Error {}
class RemoteServiceError extends Error {}

describe("run sync", () => {
  it("returns value when tryFn succeeds", () => {
    const value = run(() => 42)

    expect(value).toBe(42)
  })

  it("returns UnhandledException in function form", () => {
    const result = run(() => {
      throw new Error("boom")
    })

    expect(result).toBeInstanceOf(UnhandledException)
  })

  it("maps error when object form includes try and catch", () => {
    const result = run({
      catch: () => "mapped",
      try: () => {
        throw new Error("boom")
      },
    })

    expect(result).toBe("mapped")
  })

  it("throws Panic when catch throws", () => {
    expect(() =>
      run({
        catch: () => {
          throw new Error("catch failed")
        },
        try: () => {
          throw new Error("boom")
        },
      })
    ).toThrow(Panic)
  })

  it("supports multiple mapped error variants in sync object form", () => {
    const invalidInput = run({
      catch: (error) => {
        if (error instanceof SyntaxError) {
          return new InvalidInputError("invalid")
        }

        return new PermissionDeniedError("denied")
      },
      try: () => {
        throw new SyntaxError("bad input")
      },
    })

    const permissionDenied = run({
      catch: (error) => {
        if (error instanceof SyntaxError) {
          return new InvalidInputError("invalid")
        }

        return new PermissionDeniedError("denied")
      },
      try: () => {
        throw new Error("no access")
      },
    })

    expect(invalidInput).toBeInstanceOf(InvalidInputError)
    expect(permissionDenied).toBeInstanceOf(PermissionDeniedError)
  })
})

describe("run async", () => {
  it("returns promise value when tryFn is async", async () => {
    const result = run(async () => {
      await Promise.resolve()

      return 42
    })

    expect(await result).toBe(42)
  })

  it("returns UnhandledException when async function form rejects", async () => {
    const result = run(async () => {
      await Promise.resolve()
      throw new Error("boom")
    })

    expect(await result).toBeInstanceOf(UnhandledException)
  })

  it("maps async object form rejections through catch", async () => {
    const result = run({
      catch: () => "mapped",
      try: async () => {
        await Promise.resolve()
        throw new Error("boom")
      },
    })

    expect(await result).toBe("mapped")
  })

  it("throws Panic when async catch rejects", async () => {
    const result = run({
      catch: async () => {
        await Promise.resolve()
        throw new Error("catch failed")
      },
      try: async () => {
        await Promise.resolve()
        throw new Error("boom")
      },
    })

    try {
      await result
      throw new Error("Expected Panic rejection")
    } catch (error) {
      expect(error).toBeInstanceOf(Panic)
    }
  })

  it("supports multiple mapped error variants in async object form", async () => {
    const networkError = await run({
      catch: (error): NetworkError | RemoteServiceError => {
        if (error instanceof TypeError) {
          return new NetworkError("network")
        }

        return new RemoteServiceError("remote")
      },
      try: async () => {
        await Promise.resolve()
        throw new TypeError("fetch failed")
      },
    })

    const remoteServiceError = await run({
      catch: (error) => {
        if (error instanceof TypeError) {
          return new NetworkError("network")
        }

        return new RemoteServiceError("remote")
      },
      try: async () => {
        await Promise.resolve()
        throw new Error("500")
      },
    })

    expect(networkError).toBeInstanceOf(NetworkError)
    expect(remoteServiceError).toBeInstanceOf(RemoteServiceError)
  })
})

describe("retry execution flow", () => {
  it("handles many zero-delay sync retries without stack overflow", async () => {
    const limit = 20_000

    const result = retry({ backoff: "constant", delayMs: 0, limit }).run((ctx) => {
      if (ctx.retry.attempt < limit) {
        throw new Error("retry")
      }

      return ctx.retry.attempt
    })

    expect(await result).toBe(limit)
  })

  it("does not double-call shouldRetry when switching from sync to async retry path", async () => {
    let shouldRetryCalls = 0

    const result = retry({
      backoff: "constant",
      delayMs: 1,
      limit: 3,
      shouldRetry: () => {
        shouldRetryCalls += 1
        return true
      },
    }).run(() => {
      throw new Error("boom")
    })

    expect(await result).toBeInstanceOf(RetryExhaustedError)
    expect(shouldRetryCalls).toBe(2)
  })
})
