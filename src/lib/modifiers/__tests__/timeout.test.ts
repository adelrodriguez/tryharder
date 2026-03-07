import { describe, expect, it } from "bun:test"
import { TimeoutError } from "../../errors"
import { TimeoutController } from "../timeout"

describe("TimeoutController", () => {
  it("returns non-timing behavior when timeout is not configured", async () => {
    const controller = new TimeoutController()

    const result = await controller.race(Promise.resolve("ok"))

    expect(result).toBe("ok")
    expect(controller.checkDidTimeout()).toBeUndefined()
  })

  it("reports timeout immediately for zero milliseconds", () => {
    const controller = new TimeoutController(0)

    const timeout = controller.checkDidTimeout()

    expect(timeout).toBeInstanceOf(TimeoutError)
  })

  it("races pending promise to TimeoutError", async () => {
    const controller = new TimeoutController(5)

    const pending = new Promise<string>((resolve) => {
      void resolve
    })

    const result = await controller.race(pending)

    expect(result).toBeInstanceOf(TimeoutError)
  })

  it("aborts timeout signal with TimeoutError reason", async () => {
    const controller = new TimeoutController(5)

    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })

    expect(controller.signal?.aborted).toBe(true)
    expect(controller.signal?.reason).toBeInstanceOf(TimeoutError)
    expect(controller.checkDidTimeout()).toBeInstanceOf(TimeoutError)
  })

  it("returns TimeoutError when timing out during race with cause", async () => {
    const controller = new TimeoutController(5)
    const cause = new Error("during catch")

    const pending = new Promise<string>((resolve) => {
      void resolve
    })

    const result = await controller.race(pending, cause)

    expect(result).toBeInstanceOf(TimeoutError)
  })

  it("throws Panic when timeout is Infinity", () => {
    try {
      const controller = new TimeoutController(Infinity)
      void controller
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe("TIMEOUT_INVALID_MS")
    }
  })

  it("throws Panic when timeout is negative", () => {
    try {
      const controller = new TimeoutController(-1)
      void controller
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe("TIMEOUT_INVALID_MS")
    }
  })

  it("throws Panic when timeout is NaN", () => {
    try {
      const controller = new TimeoutController(Number.NaN)
      void controller
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe("TIMEOUT_INVALID_MS")
    }
  })
})
