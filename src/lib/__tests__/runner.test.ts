import { describe, expect, it } from "bun:test"
import { Panic, UnhandledException } from "../errors"
import { executeRun } from "../runner"

describe("executeRun", () => {
  it("returns success value in function form", () => {
    const result = executeRun({}, () => "ok" as const)

    expect(result).toBe("ok")
  })

  it("returns UnhandledException when function form throws", () => {
    const result = executeRun({}, () => {
      throw new Error("boom")
    })

    expect(result).toBeInstanceOf(UnhandledException)
  })

  it("maps errors in object form with try and catch", () => {
    const result = executeRun(
      {},
      {
        catch: () => "mapped" as const,
        try: () => {
          throw new Error("boom")
        },
      }
    )

    expect(result).toBe("mapped")
  })

  it("throws Panic when catch throws", () => {
    expect(() =>
      executeRun(
        {},
        {
          catch: () => {
            throw new Error("catch failed")
          },
          try: () => {
            throw new Error("boom")
          },
        }
      )
    ).toThrow(Panic)
  })

  it("passes normalized context to try", () => {
    const result = executeRun(
      {
        retry: { limit: 3 },
      },
      (ctx) => ({
        attempt: ctx.retry.attempt,
        hasSignal: Boolean(ctx.signal),
        limit: ctx.retry.limit,
      })
    )

    expect(result).toEqual({
      attempt: 1,
      hasSignal: false,
      limit: 3,
    })
  })
})
