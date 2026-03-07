import { describe, expect, it } from "bun:test"
import { Panic, RetryExhaustedError, TimeoutError } from "../../errors"
import { executeRun } from "../run"
import { executeRunSync } from "../run-sync"

function withMockedSetTimeout() {
  const originalSetTimeout = globalThis.setTimeout
  const delays: number[] = []

  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, timeout?: number) => {
    delays.push(Number(timeout ?? 0))

    if (typeof handler === "function") {
      handler()
    }

    return 0 as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout

  return {
    delays,
    restore: () => {
      globalThis.setTimeout = originalSetTimeout
    },
  }
}

describe("executeRun retry", () => {
  it("retries until success with configured limit", () => {
    let attempts = 0

    const result = executeRunSync(
      {
        retry: { backoff: "constant", limit: 3 },
      },
      () => {
        attempts += 1

        if (attempts < 3) {
          throw new Error("boom")
        }

        return "ok" as const
      }
    )

    expect(result).toBe("ok")
    expect(attempts).toBe(3)
  })

  it("returns RetryExhaustedError when retry limit is exhausted", () => {
    let mapped = false

    const result = executeRunSync(
      {
        retry: { backoff: "constant", limit: 2 },
      },
      {
        catch: () => {
          mapped = true

          return "mapped"
        },
        try: () => {
          throw new Error("boom")
        },
      }
    )

    expect(result).toBeInstanceOf(RetryExhaustedError)
    expect(mapped).toBe(false)
  })

  it("uses shouldRetry to stop retrying and map with catch", () => {
    let attempts = 0

    const result = executeRunSync(
      {
        retry: {
          backoff: "constant",
          limit: 5,
          shouldRetry: (_error, ctx) => ctx.retry.attempt < 2,
        },
      },
      {
        catch: () => "mapped" as const,
        try: () => {
          attempts += 1
          throw new Error("boom")
        },
      }
    )

    expect(result).toBe("mapped")
    expect(attempts).toBe(2)
  })

  it("does not retry when shouldRetry is false on first attempt", () => {
    let attempts = 0

    const result = executeRunSync(
      {
        retry: {
          backoff: "constant",
          limit: 5,
          shouldRetry: () => false,
        },
      },
      {
        catch: () => "mapped" as const,
        try: () => {
          attempts += 1
          throw new Error("boom")
        },
      }
    )

    expect(result).toBe("mapped")
    expect(attempts).toBe(1)
  })

  it("maps with async catch when shouldRetry stops before exhaustion", async () => {
    let attempts = 0

    const result = await executeRun(
      {
        retry: {
          backoff: "constant",
          limit: 5,
          shouldRetry: () => false,
        },
      },
      {
        catch: async () => {
          await Promise.resolve()
          return "mapped" as const
        },
        try: () => {
          attempts += 1
          throw new Error("boom")
        },
      }
    )

    expect(result).toBe("mapped")
    expect(attempts).toBe(1)
  })

  it("does not retry control errors", () => {
    let attempts = 0
    let mapped = false

    const result = executeRunSync(
      {
        retry: { backoff: "constant", limit: 3 },
      },
      {
        catch: () => {
          mapped = true

          return "mapped"
        },
        try: () => {
          attempts += 1
          throw new TimeoutError()
        },
      }
    )

    expect(result).toBeInstanceOf(TimeoutError)
    expect(attempts).toBe(1)
    expect(mapped).toBe(false)
  })

  it("throws Panic when sync runner is used with async-required retry policy", () => {
    try {
      executeRunSync(
        {
          retry: { backoff: "linear", delayMs: 10, limit: 3 },
        },
        () => {
          throw new Error("boom")
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Panic)
      expect((error as Panic).code).toBe("RUN_SYNC_ASYNC_RETRY_POLICY")
    }
  })

  it("throws Panic when sync runner is used with jittered constant retry", () => {
    try {
      executeRunSync(
        {
          retry: { backoff: "constant", delayMs: 0, jitter: true, limit: 3 },
        },
        () => {
          throw new Error("boom")
        }
      )
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Panic)
      expect((error as Panic).code).toBe("RUN_SYNC_ASYNC_RETRY_POLICY")
    }
  })

  it("applies linear backoff delays between retries", async () => {
    const { delays, restore } = withMockedSetTimeout()

    try {
      const result = await executeRun(
        {
          retry: { backoff: "linear", delayMs: 10, limit: 4 },
        },
        () => {
          throw new Error("boom")
        }
      )

      expect(result).toBeInstanceOf(RetryExhaustedError)
      expect(delays).toEqual([10, 20, 30])
    } finally {
      restore()
    }
  })

  it("applies exponential backoff delays with maxDelayMs cap", async () => {
    const { delays, restore } = withMockedSetTimeout()

    try {
      const result = await executeRun(
        {
          retry: { backoff: "exponential", delayMs: 5, limit: 5, maxDelayMs: 12 },
        },
        () => {
          throw new Error("boom")
        }
      )

      expect(result).toBeInstanceOf(RetryExhaustedError)
      expect(delays).toEqual([5, 10, 12, 12])
    } finally {
      restore()
    }
  })
})
