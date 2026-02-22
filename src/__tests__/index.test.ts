import { describe, expect, it } from "bun:test"
import { Panic, UnhandledException, run } from "../index"

describe("run sync", () => {
  it("returns value when tryFn succeeds", () => {
    const value = run(() => 42)

    expect(value).toBe(42)
  })

  it("returns UnhandledException in function form", () => {
    const result = run(() => {
      throw new Error("boom")
    })

    expect(result).toBeInstanceOf(UnhandledException)
  })

  it("maps error when object form includes try and catch", () => {
    const result = run({
      catch: () => "mapped",
      try: () => {
        throw new Error("boom")
      },
    })

    expect(result).toBe("mapped")
  })

  it("throws Panic when catch throws", () => {
    expect(() =>
      run({
        catch: () => {
          throw new Error("catch failed")
        },
        try: () => {
          throw new Error("boom")
        },
      })
    ).toThrow(Panic)
  })
})
