import { describe, expect, it } from "bun:test"
import { Panic, UnhandledException } from "../errors"
import { executeRun } from "../runner"

describe("executeRun", () => {
  describe("sync", () => {
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

    it("passes normalized context to try", async () => {
      const result = executeRun(
        {
          retry: { backoff: "constant", limit: 3 },
        },
        (ctx) => ({
          attempt: ctx.retry.attempt,
          hasSignal: Boolean(ctx.signal),
          limit: ctx.retry.limit,
        })
      )

      expect(await result).toEqual({
        attempt: 1,
        hasSignal: false,
        limit: 3,
      })
    })
  })

  describe("async", () => {
    it("returns resolved value when function form is async", async () => {
      const result = executeRun({}, async () => {
        await Promise.resolve()

        return "ok" as const
      })

      expect(await result).toBe("ok")
    })

    it("maps rejected value to UnhandledException in async function form", async () => {
      const result = executeRun({}, async () => {
        await Promise.resolve()
        throw new Error("boom")
      })

      expect(await result).toBeInstanceOf(UnhandledException)
    })

    it("maps async try rejection through catch in object form", async () => {
      const result = executeRun(
        {},
        {
          catch: () => "mapped",
          try: async () => {
            await Promise.resolve()
            throw new Error("boom")
          },
        }
      )

      expect(await result).toBe("mapped")
    })

    it("throws Panic when async catch rejects", async () => {
      const result = executeRun(
        {},
        {
          catch: async () => {
            await Promise.resolve()
            throw new Error("catch failed")
          },
          try: async () => {
            await Promise.resolve()
            throw new Error("boom")
          },
        }
      )

      try {
        await result
        throw new Error("Expected Panic rejection")
      } catch (error) {
        expect(error).toBeInstanceOf(Panic)
      }
    })
  })
})
