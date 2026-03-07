import type { TimeoutOptions, TimeoutPolicy } from "../types/builder"
import { TimeoutError } from "../errors"
import { raceWithAbortSignal } from "../utils"

export function normalizeTimeoutOptions(options: TimeoutOptions): TimeoutPolicy {
  if (typeof options === "number") {
    return { ms: options, scope: "total" }
  }

  return { ...options }
}

export class TimeoutController {
  readonly signal?: AbortSignal
  readonly #controller?: AbortController
  readonly #startedAt = Date.now()
  readonly #timeoutMs: number
  #timeoutId: ReturnType<typeof setTimeout> | undefined

  constructor(timeoutPolicy?: TimeoutPolicy) {
    this.#timeoutMs = timeoutPolicy?.ms ?? -1

    if (!timeoutPolicy) {
      return
    }

    this.#controller = new AbortController()
    this.signal = this.#controller.signal

    if (this.#timeoutMs <= 0) {
      this.#abort()
      return
    }

    this.#timeoutId = setTimeout(() => {
      this.#abort()
    }, this.#timeoutMs)
  }

  #abort(cause?: unknown): TimeoutError {
    const timeoutError =
      cause === undefined
        ? new TimeoutError(`Execution exceeded timeout of ${this.#timeoutMs}ms`)
        : new TimeoutError(`Execution exceeded timeout of ${this.#timeoutMs}ms`, { cause })

    if (!this.signal?.aborted) {
      this.#controller?.abort(timeoutError)
    }

    return timeoutError
  }

  #getRemaining(): number {
    const elapsed = Date.now() - this.#startedAt

    return this.#timeoutMs - elapsed
  }

  checkDidTimeout(cause?: unknown): TimeoutError | undefined {
    if (!this.signal) {
      return undefined
    }

    if (this.signal.aborted) {
      const reason = this.signal.reason

      if (reason instanceof TimeoutError) {
        return reason
      }

      return cause === undefined && reason === undefined
        ? new TimeoutError(`Execution exceeded timeout of ${this.#timeoutMs}ms`)
        : new TimeoutError(`Execution exceeded timeout of ${this.#timeoutMs}ms`, {
            cause: cause ?? reason,
          })
    }

    const remaining = this.#getRemaining()

    if (remaining > 0) {
      return undefined
    }

    return this.#abort(cause)
  }

  async race<V>(promise: PromiseLike<V>, cause?: unknown): Promise<V | TimeoutError> {
    if (!this.signal) {
      return promise
    }

    const remaining = this.#getRemaining()

    if (remaining <= 0) {
      return this.#abort(cause)
    }

    const timedOut = this.checkDidTimeout(cause)

    if (timedOut) {
      return timedOut
    }

    return await raceWithAbortSignal(
      this.signal,
      promise,
      () =>
        this.checkDidTimeout(cause) ??
        (cause === undefined
          ? new TimeoutError(`Execution exceeded timeout of ${this.#timeoutMs}ms`)
          : new TimeoutError(`Execution exceeded timeout of ${this.#timeoutMs}ms`, { cause }))
    )
  }

  [Symbol.dispose](): void {
    if (this.#timeoutId !== undefined) {
      clearTimeout(this.#timeoutId)
    }
  }
}
