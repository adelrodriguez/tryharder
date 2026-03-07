import { describe, expect, it } from "bun:test"
import { Panic, UnhandledException } from "../../errors"
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
        async b(this: { $result: { a: Promise<number> } }) {
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
    let resolveBReady!: () => void
    const bReady = new Promise<void>((resolve) => {
      resolveBReady = resolve
    })
    let resolveAbortObserved!: () => void
    const abortObserved = new Promise<void>((resolve) => {
      resolveAbortObserved = resolve
    })

    await using execution = new TaskExecution(
      undefined,
      {
        async a() {
          await bReady
          throw new Error("boom")
        },
        async b(this: { $signal: AbortSignal }) {
          if (this.$signal.aborted) {
            resolveBReady()
            signalAbortedInB = true
            resolveAbortObserved()
            return "never"
          }

          await new Promise<void>((resolve) => {
            this.$signal.addEventListener(
              "abort",
              () => {
                resolve()
              },
              { once: true }
            )
            resolveBReady()
          })

          signalAbortedInB = this.$signal.aborted
          resolveAbortObserved()
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

    await abortObserved
    expect(execution.failedTask).toBe("a")
    expect(signalAbortedInB).toBe(true)
  })

  it("does not wait for a sibling to settle in fail-fast mode", async () => {
    await using execution = new TaskExecution(
      undefined,
      {
        a() {
          throw new Error("boom")
        },
        async b() {
          await new Promise<void>((resolve) => {
            void resolve
          })
          return "never"
        },
      },
      "fail-fast"
    )

    const result = await Promise.race([
      execution.execute().then(
        () => "resolved" as const,
        (error: unknown) => error
      ),
      sleep(25).then(() => "timed-out" as const),
    ])

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe("boom")
  })

  it("normalizes undefined fail-fast rejections", async () => {
    await using execution = new TaskExecution(
      undefined,
      {
        a() {
          throw undefined
        },
      },
      "fail-fast"
    )

    try {
      await execution.execute()
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(UnhandledException)
      expect((error as UnhandledException).cause).toBeUndefined()
    }
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
        async b(this: { $signal: AbortSignal }) {
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
        async a(this: { $result: Record<string, Promise<unknown>> }) {
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

  it("normalizes queued dependency failures while preserving raw settled reasons", async () => {
    await using execution = new TaskExecution(
      undefined,
      {
        async a() {
          await sleep(5)
          throw "boom"
        },
        async b(this: { $result: { a: Promise<unknown> } }) {
          return await this.$result.a
        },
      },
      "settled"
    )

    const result = (await execution.execute()) as {
      a: { reason: unknown; status: string }
      b: { reason: unknown; status: string }
    }

    expect(result.a).toEqual({ reason: "boom", status: "rejected" })
    expect(result.b.status).toBe("rejected")
    expect(result.b.reason).toBeInstanceOf(UnhandledException)
    expect((result.b.reason as Error).cause).toBe("boom")
  })
})
