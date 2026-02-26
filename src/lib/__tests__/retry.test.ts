import { describe, expect, it } from "bun:test"
import type { BuilderConfig } from "../types/builder"
import type { TryCtx } from "../types/core"
import { RetryExhaustedError, TimeoutError } from "../errors"
import {
  calculateRetryDelay,
  checkIsRetryExhausted,
  checkShouldAttemptRetry,
  normalizeRetryPolicy,
  retryOptions,
} from "../retry"
import { executeRunAsync, executeRunSync } from "../runner"

function createTestCtx(attempt: number, config: BuilderConfig): TryCtx {
  return {
    retry: {
      attempt,
      limit: config.retry?.limit ?? 1,
    },
    signal: config.signal,
  }
}

const shouldRetry = () => true

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

describe("normalizeRetryPolicy", () => {
  it("normalizes number shorthand to constant backoff", () => {
    expect(normalizeRetryPolicy(3)).toEqual({
      backoff: "constant",
      delayMs: 0,
      limit: 3,
    })
  })

  it("normalizes linear policy with default delay", () => {
    expect(normalizeRetryPolicy({ backoff: "linear", limit: 2 })).toEqual({
      backoff: "linear",
      delayMs: 0,
      jitter: undefined,
      limit: 2,
      shouldRetry: undefined,
    })
  })

  it("normalizes exponential policy and preserves maxDelayMs", () => {
    expect(
      normalizeRetryPolicy({
        backoff: "exponential",
        limit: 4,
        maxDelayMs: 1000,
      })
    ).toEqual({
      backoff: "exponential",
      delayMs: 0,
      jitter: undefined,
      limit: 4,
      maxDelayMs: 1000,
      shouldRetry: undefined,
    })
  })

  it("preserves optional retry controls", () => {
    expect(
      normalizeRetryPolicy({
        backoff: "constant",
        delayMs: 25,
        jitter: true,
        limit: 5,
        shouldRetry,
      })
    ).toEqual({
      backoff: "constant",
      delayMs: 25,
      jitter: true,
      limit: 5,
      shouldRetry,
    })
  })
})

describe("retryOptions", () => {
  it("returns normalized retry policy", () => {
    expect(retryOptions(2)).toEqual({
      backoff: "constant",
      delayMs: 0,
      limit: 2,
    })
  })
})

describe("calculateRetryDelay", () => {
  it("returns 0 when no retry policy is configured", () => {
    expect(calculateRetryDelay(1, {})).toBe(0)
  })

  it("returns constant delay regardless of attempt", () => {
    const config: BuilderConfig = {
      retry: { backoff: "constant", delayMs: 50, limit: 3 },
    }

    expect(calculateRetryDelay(1, config)).toBe(50)
    expect(calculateRetryDelay(2, config)).toBe(50)
    expect(calculateRetryDelay(3, config)).toBe(50)
  })

  it("returns linearly increasing delay", () => {
    const config: BuilderConfig = {
      retry: { backoff: "linear", delayMs: 10, limit: 5 },
    }

    expect(calculateRetryDelay(1, config)).toBe(10)
    expect(calculateRetryDelay(2, config)).toBe(20)
    expect(calculateRetryDelay(3, config)).toBe(30)
  })

  it("returns exponentially increasing delay", () => {
    const config: BuilderConfig = {
      retry: { backoff: "exponential", delayMs: 5, limit: 5 },
    }

    expect(calculateRetryDelay(1, config)).toBe(5)
    expect(calculateRetryDelay(2, config)).toBe(10)
    expect(calculateRetryDelay(3, config)).toBe(20)
    expect(calculateRetryDelay(4, config)).toBe(40)
  })

  it("caps exponential delay at maxDelayMs", () => {
    const config: BuilderConfig = {
      retry: { backoff: "exponential", delayMs: 5, limit: 5, maxDelayMs: 12 },
    }

    expect(calculateRetryDelay(1, config)).toBe(5)
    expect(calculateRetryDelay(2, config)).toBe(10)
    expect(calculateRetryDelay(3, config)).toBe(12)
    expect(calculateRetryDelay(4, config)).toBe(12)
  })

  it("defaults delay to 0 when delayMs is not set", () => {
    const config: BuilderConfig = {
      retry: { backoff: "constant", limit: 3 },
    }

    expect(calculateRetryDelay(1, config)).toBe(0)
  })
})

describe("checkShouldAttemptRetry", () => {
  it("returns false when no retry policy is configured", () => {
    const config: BuilderConfig = {}
    expect(checkShouldAttemptRetry(new Error("boom"), createTestCtx(1, config), config)).toBe(false)
  })

  it("returns true when attempt is below limit", () => {
    const config: BuilderConfig = {
      retry: { backoff: "constant", limit: 3 },
    }

    expect(checkShouldAttemptRetry(new Error("boom"), createTestCtx(1, config), config)).toBe(true)
    expect(checkShouldAttemptRetry(new Error("boom"), createTestCtx(2, config), config)).toBe(true)
  })

  it("returns false when attempt meets or exceeds limit", () => {
    const config: BuilderConfig = {
      retry: { backoff: "constant", limit: 3 },
    }

    expect(checkShouldAttemptRetry(new Error("boom"), createTestCtx(3, config), config)).toBe(false)
    expect(checkShouldAttemptRetry(new Error("boom"), createTestCtx(4, config), config)).toBe(false)
  })

  it("delegates to shouldRetry callback when provided", () => {
    const config: BuilderConfig = {
      retry: {
        backoff: "constant",
        limit: 5,
        shouldRetry: (_error, ctx) => ctx.retry.attempt < 2,
      },
    }

    expect(checkShouldAttemptRetry(new Error("boom"), createTestCtx(1, config), config)).toBe(true)
    expect(checkShouldAttemptRetry(new Error("boom"), createTestCtx(2, config), config)).toBe(false)
  })
})

describe("checkIsRetryExhausted", () => {
  it("returns false when no retry policy is configured", () => {
    expect(checkIsRetryExhausted(1, {})).toBe(false)
  })

  it("returns false when attempt is below limit", () => {
    const config: BuilderConfig = {
      retry: { backoff: "constant", limit: 3 },
    }

    expect(checkIsRetryExhausted(1, config)).toBe(false)
    expect(checkIsRetryExhausted(2, config)).toBe(false)
  })

  it("returns true when attempt meets limit", () => {
    const config: BuilderConfig = {
      retry: { backoff: "constant", limit: 3 },
    }

    expect(checkIsRetryExhausted(3, config)).toBe(true)
  })

  it("returns true when attempt exceeds limit", () => {
    const config: BuilderConfig = {
      retry: { backoff: "constant", limit: 3 },
    }

    expect(checkIsRetryExhausted(4, config)).toBe(true)
  })
})

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

    const result = await executeRunAsync(
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

  it("throws when sync runner is used with async-required retry policy", () => {
    expect(() =>
      executeRunSync(
        {
          retry: { backoff: "linear", delayMs: 10, limit: 3 },
        },
        () => {
          throw new Error("boom")
        }
      )
    ).toThrow("Use runAsync() instead of run()")
  })

  it("throws when sync runner is used with jittered constant retry", () => {
    expect(() =>
      executeRunSync(
        {
          retry: { backoff: "constant", delayMs: 0, jitter: true, limit: 3 },
        },
        () => {
          throw new Error("boom")
        }
      )
    ).toThrow("Use runAsync() instead of run()")
  })

  it("applies linear backoff delays between retries", async () => {
    const { delays, restore } = withMockedSetTimeout()

    try {
      const result = await executeRunAsync(
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
      const result = await executeRunAsync(
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
