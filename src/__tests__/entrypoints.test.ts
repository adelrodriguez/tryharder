import { describe, expect, it } from "bun:test"
import {
  CancellationError,
  Panic,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "../errors"
import * as try$ from "../index"
import { expectPanic } from "./test-utils"

describe("entrypoints", () => {
  it("does not expose errors from the root entrypoint", () => {
    expect("CancellationError" in try$).toBe(false)
    expect("Panic" in try$).toBe(false)
    expect("RetryExhaustedError" in try$).toBe(false)
    expect("TimeoutError" in try$).toBe(false)
    expect("UnhandledException" in try$).toBe(false)
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
})
