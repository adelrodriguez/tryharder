import { expect } from "vitest"
import { Panic, type PanicCode } from "../errors"

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function expectPanic(error: unknown, code: PanicCode) {
  expect(error).toBeInstanceOf(Panic)
  expect((error as Panic).code).toBe(code)
}
