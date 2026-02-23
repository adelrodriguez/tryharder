import { CancellationError, TimeoutError } from "./errors"

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

    const signal = this.signal
    using disposer = new DisposableStack()

    const cancellationPromise = new Promise<CancellationError>((resolve) => {
      const onAbort = () => {
        resolve(this.#createCancellationError(cause))
      }

      signal.addEventListener("abort", onAbort, { once: true })
      disposer.defer(() => {
        signal.removeEventListener("abort", onAbort)
      })
    })

    return await Promise.race([Promise.resolve(promise), cancellationPromise])
  }

  [Symbol.dispose](): void {
    void this.signal
  }
}
