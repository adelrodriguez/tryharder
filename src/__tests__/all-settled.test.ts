import { describe, expect, it } from "bun:test"
import * as try$ from "../index"
import { sleep } from "../lib/utils"

describe("allSettled", () => {
  it("returns empty object when task map is empty", async () => {
    const result = await try$.allSettled({})

    expect(result).toEqual({})
  })

  it("returns mixed fulfilled and rejected task results", async () => {
    const boom = new Error("boom")

    const result = await try$.allSettled({
      a() {
        return 1
      },
      b() {
        throw boom
      },
    })

    expect(result.a).toEqual({ status: "fulfilled", value: 1 })
    expect(result.b).toEqual({ reason: boom, status: "rejected" })
  })

  it("does not reject outer promise when tasks fail", async () => {
    const result = await try$.allSettled({
      a() {
        throw new Error("a failed")
      },
      b() {
        throw new Error("b failed")
      },
    })

    expect(result.a.status).toBe("rejected")
    expect(result.b.status).toBe("rejected")
  })

  it("allows dependent tasks to handle failed dependencies", async () => {
    const result = await try$.allSettled({
      a() {
        throw new Error("a failed")
      },
      async b() {
        try {
          return await this.$result.a
        } catch {
          return "fallback"
        }
      },
    })

    expect(result.a.status).toBe("rejected")
    expect(result.b).toEqual({ status: "fulfilled", value: "fallback" })
  })

  it("returns settled results with retry and timeout builder options", async () => {
    const result = await try$
      .retry(3)
      .timeout(100)
      .allSettled({
        a() {
          return 1
        },
        b() {
          throw new Error("boom")
        },
      })

    expect(result.a).toEqual({ status: "fulfilled", value: 1 })
    expect(result.b.status).toBe("rejected")
  })

  it("honors cancellation signal from builder options", async () => {
    const controller = new AbortController()

    const pending = try$
      .retry(3)
      .timeout(100)
      .signal(controller.signal)
      .allSettled({
        async a() {
          await sleep(20)

          if (this.$signal.aborted) {
            throw this.$signal.reason
          }

          return 1
        },
        async b() {
          await sleep(25)

          if (this.$signal.aborted) {
            throw this.$signal.reason
          }

          return 2
        },
      })

    setTimeout(() => {
      controller.abort(new Error("stop"))
    }, 5)

    const result = await pending

    expect(result.a.status).toBe("rejected")
    expect(result.b.status).toBe("rejected")
  })
})
