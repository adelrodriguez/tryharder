import type { TimeoutPolicy } from "./types/builder"
import { TimeoutError } from "./errors"

export interface TimeoutController {
  checkDidTimeout(cause?: unknown): TimeoutError | undefined
  raceWithTimeout<V>(promise: PromiseLike<V>, cause?: unknown): Promise<V | TimeoutError>
}

function createTimeoutCause(timeoutMs: number): Error {
  return new Error(`Execution exceeded timeout of ${timeoutMs}ms`)
}

export function createTimeoutController(timeoutPolicy?: TimeoutPolicy): TimeoutController {
  const timeoutMs = timeoutPolicy?.ms
  const startedAt = timeoutMs === undefined ? 0 : Date.now()

  const createTimeoutError = (cause?: unknown): TimeoutError => {
    if (timeoutMs === undefined) {
      return new TimeoutError({ cause })
    }

    return new TimeoutError({ cause: cause ?? createTimeoutCause(timeoutMs) })
  }

  const getRemainingTimeoutMs = (): number | undefined => {
    if (timeoutMs === undefined) {
      return undefined
    }

    const elapsed = Date.now() - startedAt

    return timeoutMs - elapsed
  }

  const checkDidTimeout = (cause?: unknown): TimeoutError | undefined => {
    const remaining = getRemainingTimeoutMs()

    if (remaining === undefined || remaining > 0) {
      return undefined
    }

    return createTimeoutError(cause)
  }

  const raceWithTimeout = async <V>(
    promise: PromiseLike<V>,
    cause?: unknown
  ): Promise<V | TimeoutError> => {
    const remaining = getRemainingTimeoutMs()

    if (remaining === undefined) {
      return promise
    }

    if (remaining <= 0) {
      return createTimeoutError(cause)
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const timeoutPromise = new Promise<TimeoutError>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve(createTimeoutError(cause))
      }, remaining)
    })

    try {
      return await Promise.race([Promise.resolve(promise), timeoutPromise])
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  }

  return {
    checkDidTimeout,
    raceWithTimeout,
  }
}
