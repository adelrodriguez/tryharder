import { describe, expect, it } from "bun:test"
import { Panic } from "../../errors"
import { sleep } from "../../utils"
import { TaskExecution } from "../shared"

describe("TaskExecution", () => {
  it("runs fail-fast task graphs and returns plain values", async () => {
    await using execution = new TaskExecution(
      undefined,
      {
        a() {
          return 1
        },
        async b(this: { $result: { a: Promise<number> } }): Promise<number> {
          const a = await this.$result.a
          return a + 1
        },
      },
      "fail-fast"
    )

    const result = await execution.execute()

    expect(result).toEqual({ a: 1, b: 2 })
    expect(execution.failedTask).toBeUndefined()
  })

  it("records failedTask and aborts siblings in fail-fast mode", async () => {
    let signalAbortedInB = false

    await using execution = new TaskExecution(
      undefined,
      {
        a() {
          throw new Error("boom")
        },
        async b(this: { $signal: AbortSignal }): Promise<string> {
          if (!this.$signal.aborted) {
            await new Promise<void>((resolve) => {
              this.$signal.addEventListener(
                "abort",
                () => {
                  resolve()
                },
                { once: true }
              )
            })
          }

          signalAbortedInB = this.$signal.aborted
          return "never"
        },
      },
      "fail-fast"
    )

    try {
      await execution.execute()
      expect.unreachable("should have thrown")
    } catch (error) {
      expect((error as Error).message).toBe("boom")
    }

    await sleep(5)
    expect(execution.failedTask).toBe("a")
    expect(signalAbortedInB).toBe(true)
  })

  it("collects all outcomes in settled mode without aborting siblings", async () => {
    const error = new Error("boom")
    let signalAbortedInB = false

    await using execution = new TaskExecution(
      undefined,
      {
        a() {
          throw error
        },
        async b(this: { $signal: AbortSignal }): Promise<number> {
          await sleep(5)
          signalAbortedInB = this.$signal.aborted
          return 2
        },
      },
      "settled"
    )

    const result = (await execution.execute()) as {
      a: { reason: unknown; status: string }
      b: { status: string; value: unknown }
    }

    expect(result.a).toEqual({ reason: error, status: "rejected" })
    expect(result.b).toEqual({ status: "fulfilled", value: 2 })
    expect(signalAbortedInB).toBe(false)
    expect(execution.failedTask).toBe("a")
  })

  it("marks invalid result references as rejected in settled mode", async () => {
    await using execution = new TaskExecution(
      undefined,
      {
        async a(this: { $result: Record<string, Promise<unknown>> }): Promise<unknown> {
          return await this.$result.missing
        },
      },
      "settled"
    )

    const result = (await execution.execute()) as {
      a: { reason: unknown; status: string }
    }

    expect(result.a.status).toBe("rejected")
    expect(result.a.reason).toBeInstanceOf(Panic)
    expect((result.a.reason as Panic).code).toBe("TASK_UNKNOWN_REFERENCE")
  })
})
