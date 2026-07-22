import { describe, expect, it } from "bun:test"
import {
  CancellationError,
  isCancellationError,
  isPanic,
  isRetryExhaustedError,
  isTimeoutError,
  isUnhandledException,
  Panic,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "../errors"
import * as try$ from "../index"
import { expectPanic } from "./test-utils"

function createForeignError(name: string, extras: Record<string, unknown> = {}): Error {
  // Simulates an error created by a duplicate copy of tryharder (or another
  // realm): instanceof fails, but the name-based guards must still match.
  const foreign = new Error("foreign")
  foreign.name = name
  Object.assign(foreign, extras)
  return foreign
}

describe("entrypoints", () => {
  it("does not expose errors from the root entrypoint", () => {
    expect("CancellationError" in try$).toBe(false)
    expect("Panic" in try$).toBe(false)
    expect("RetryExhaustedError" in try$).toBe(false)
    expect("TimeoutError" in try$).toBe(false)
    expect("UnhandledException" in try$).toBe(false)
    expect("isCancellationError" in try$).toBe(false)
    expect("isPanic" in try$).toBe(false)
  })

  it("exposes errors from the dedicated errors entrypoint", () => {
    const panic = new Panic("FLOW_NO_EXIT")

    expect(panic.name).toBe("Panic")
    expect(panic.message).toBe("flow() requires at least one task to call $exit().")
    expect(panic.code).toBe("FLOW_NO_EXIT")
    expect(new CancellationError().name).toBe("CancellationError")
    expect(new CancellationError().message).toBe("Execution was cancelled")
    expect(new RetryExhaustedError().name).toBe("RetryExhaustedError")
    expect(new RetryExhaustedError().message).toBe("Retry attempts exhausted")
    expect(new TimeoutError().name).toBe("TimeoutError")
    expect(new TimeoutError().message).toBe("Execution timed out")
    expect(new UnhandledException().name).toBe("UnhandledException")
    expect(new UnhandledException().message).toBe("Unhandled exception")
  })

  it("exposes retryOptions from the root entrypoint", () => {
    expect(try$.retryOptions(2)).toEqual({
      backoff: "constant",
      delayMs: 0,
      limit: 2,
    })
  })

  it("throws Panic when timeout() receives Infinity", () => {
    try {
      try$.timeout(Infinity)
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TIMEOUT_INVALID_MS")
    }
  })

  it("throws Panic when timeout() receives a negative number", () => {
    try {
      try$.timeout(-1)
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TIMEOUT_INVALID_MS")
    }
  })

  it("throws Panic when timeout() receives NaN", () => {
    try {
      try$.timeout(Number.NaN)
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "TIMEOUT_INVALID_MS")
    }
  })

  it("throws Panic when retry() receives Infinity", () => {
    try {
      try$.retry(Infinity)
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "RETRY_INVALID_LIMIT")
    }
  })

  it("throws Panic when retry() receives a negative number", () => {
    try {
      try$.retry(-1 as number)
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "RETRY_INVALID_LIMIT")
    }
  })

  it("throws Panic when retry() receives NaN", () => {
    try {
      try$.retry(Number.NaN)
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "RETRY_INVALID_LIMIT")
    }
  })

  it("throws Panic when retry() receives zero", () => {
    try {
      try$.retry(0 as number)
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "RETRY_INVALID_LIMIT")
    }
  })

  it("throws Panic when retry() receives a fractional limit", () => {
    try {
      try$.retry(2.5 as number)
      expect.unreachable("should have thrown")
    } catch (error) {
      expectPanic(error, "RETRY_INVALID_LIMIT")
    }
  })

  describe("error type guards", () => {
    it("matches genuine instances", () => {
      expect(isCancellationError(new CancellationError())).toBe(true)
      expect(isTimeoutError(new TimeoutError())).toBe(true)
      expect(isRetryExhaustedError(new RetryExhaustedError())).toBe(true)
      expect(isUnhandledException(new UnhandledException())).toBe(true)
      expect(isPanic(new Panic("FLOW_NO_EXIT"))).toBe(true)
    })

    it("matches foreign errors by name when instanceof fails", () => {
      const foreignCancellation = createForeignError("CancellationError")

      expect(foreignCancellation).not.toBeInstanceOf(CancellationError)
      expect(isCancellationError(foreignCancellation)).toBe(true)

      expect(isTimeoutError(createForeignError("TimeoutError"))).toBe(true)
      expect(isRetryExhaustedError(createForeignError("RetryExhaustedError"))).toBe(true)
      expect(isUnhandledException(createForeignError("UnhandledException"))).toBe(true)
      expect(isPanic(createForeignError("Panic", { code: "FLOW_NO_EXIT" }))).toBe(true)
    })

    it("requires a string code for foreign Panic errors", () => {
      expect(isPanic(createForeignError("Panic"))).toBe(false)
      expect(isPanic(createForeignError("Panic", { code: 42 }))).toBe(false)
    })

    it("rejects non-errors and unrelated names", () => {
      expect(isCancellationError(null)).toBe(false)
      expect(isTimeoutError(0)).toBe(false)
      expect(isRetryExhaustedError("RetryExhaustedError")).toBe(false)
      expect(isUnhandledException({ name: "UnhandledException" })).toBe(false)
      expect(isPanic(new Error("Panic"))).toBe(false)
      expect(isCancellationError(new TimeoutError())).toBe(false)
    })
  })
})
