import { describe, expect, it } from "bun:test"
import type { Panic } from "../../errors"
import type { BuilderConfig } from "../../types/builder"
import type { TryCtx } from "../../types/core"
import {
  retryOptions,
  calculateRetryDelay,
  checkIsRetryExhausted,
  checkShouldAttemptRetry,
} from "../retry"

function createTestCtx(attempt: number, config: BuilderConfig): TryCtx {
  return {
    retry: {
      attempt,
      limit: config.retry?.limit ?? 1,
    },
    signal: config.signals?.[0],
  }
}

const shouldRetry = () => true

describe("retryOptions", () => {
  it("normalizes number shorthand to constant backoff", () => {
    expect(retryOptions(3)).toEqual({
      backoff: "constant",
      delayMs: 0,
      limit: 3,
    })
  })

  it("normalizes linear policy with default delay", () => {
    expect(retryOptions({ backoff: "linear", limit: 2 })).toEqual({
      backoff: "linear",
      delayMs: 0,
      jitter: undefined,
      limit: 2,
      shouldRetry: undefined,
    })
  })

  it("normalizes exponential policy and preserves maxDelayMs", () => {
    expect(
      retryOptions({
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
      retryOptions({
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

  it("returns normalized retry policy for root helper usage", () => {
    expect(retryOptions(2)).toEqual({
      backoff: "constant",
      delayMs: 0,
      limit: 2,
    })
  })

  it("throws Panic when numeric shorthand limit is Infinity", () => {
    try {
      retryOptions(Infinity)
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Panic).code).toBe("RETRY_INVALID_LIMIT")
    }
  })

  it("throws Panic when object limit is NaN", () => {
    try {
      retryOptions({ backoff: "constant", limit: Number.NaN })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Panic).code).toBe("RETRY_INVALID_LIMIT")
    }
  })

  it("throws Panic when limit is negative", () => {
    try {
      retryOptions(-1)
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Panic).code).toBe("RETRY_INVALID_LIMIT")
    }
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
