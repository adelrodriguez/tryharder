import { CancellationError, TimeoutError } from "../errors"
import { raceWithAbortSignal } from "../utils"

export class SignalController {
  readonly signal?: AbortSignal

  constructor(signals: readonly AbortSignal[] = []) {
    if (signals.length > 0) {
      this.signal = AbortSignal.any([...signals])
    }
  }

  #createCancellationError(cause?: unknown): CancellationError {
    return new CancellationError({ cause: cause ?? this.signal?.reason })
  }

  checkDidCancel(cause?: unknown): CancellationError | undefined {
    if (!this.signal?.aborted) {
      return undefined
    }

    if (this.signal.reason instanceof TimeoutError) {
      return undefined
    }

    return this.#createCancellationError(cause)
  }

  async race<V>(promise: PromiseLike<V>, cause?: unknown): Promise<V | CancellationError> {
    const cancelled = this.checkDidCancel(cause)

    if (cancelled) {
      return cancelled
    }

    if (!this.signal) {
      return promise
    }

    return await raceWithAbortSignal(this.signal, promise, () =>
      this.#createCancellationError(cause)
    )
  }

  [Symbol.dispose](): void {
    void this.signal
  }
}
