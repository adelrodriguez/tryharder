import { describe, expect, it } from "bun:test"
import { TimeoutError } from "../errors"
import { createTimeoutController } from "../timeout"

describe("createTimeoutController", () => {
  it("returns non-timing behavior when timeout is not configured", async () => {
    const controller = createTimeoutController()

    const result = await controller.raceWithTimeout(Promise.resolve("ok"))

    expect(result).toBe("ok")
    expect(controller.checkDidTimeout()).toBeUndefined()
  })

  it("reports timeout immediately for zero milliseconds", () => {
    const controller = createTimeoutController({ ms: 0, scope: "total" })

    const timeout = controller.checkDidTimeout()

    expect(timeout).toBeInstanceOf(TimeoutError)
  })

  it("races pending promise to TimeoutError", async () => {
    const controller = createTimeoutController({ ms: 5, scope: "total" })

    const pending = new Promise<string>((resolve) => {
      void resolve
    })

    const result = await controller.raceWithTimeout(pending)

    expect(result).toBeInstanceOf(TimeoutError)
  })

  it("aborts timeout signal with TimeoutError reason", async () => {
    const controller = createTimeoutController({ ms: 5, scope: "total" })

    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })

    expect(controller.signal?.aborted).toBe(true)
    expect(controller.signal?.reason).toBeInstanceOf(TimeoutError)
    expect(controller.checkDidTimeout()).toBeInstanceOf(TimeoutError)
  })

  it("returns TimeoutError when timing out during race with cause", async () => {
    const controller = createTimeoutController({ ms: 5, scope: "total" })
    const cause = new Error("during catch")

    const pending = new Promise<string>((resolve) => {
      void resolve
    })

    const result = await controller.raceWithTimeout(pending, cause)

    expect(result).toBeInstanceOf(TimeoutError)
  })
})
