import { CancellationError, Panic, TimeoutError } from "./errors"

export function assertUnreachable(value: never): never {
  throw new Error(`Unreachable case: ${String(value)}`)
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function checkIsControlError(
  error: unknown
): error is CancellationError | Panic | TimeoutError {
  return (
    error instanceof CancellationError || error instanceof Panic || error instanceof TimeoutError
  )
}

export function checkIsPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  )
}
