import { CancellationError, TimeoutError } from "../errors"
import { raceWithAbortSignal } from "../utils"

export class SignalController {
  readonly signal?: AbortSignal

  constructor(signals: readonly AbortSignal[] = []) {
    if (signals.length > 0) {
      this.signal = AbortSignal.any([...signals])
    }
  }

  checkDidCancel(cause?: unknown): CancellationError | undefined {
    if (!this.signal?.aborted) {
      return undefined
    }

    if (this.signal.reason instanceof TimeoutError) {
      return undefined
    }

    return new CancellationError(undefined, { cause: cause ?? this.signal.reason })
  }

  async race<V>(promise: PromiseLike<V>, cause?: unknown): Promise<V | CancellationError> {
    const cancelled = this.checkDidCancel(cause)

    if (cancelled) {
      return cancelled
    }

    if (!this.signal) {
      return promise
    }

    return await raceWithAbortSignal(
      this.signal,
      promise,
      () => new CancellationError(undefined, { cause: cause ?? this.signal?.reason })
    )
  }

  [Symbol.dispose](): void {
    void this.signal
  }
}
