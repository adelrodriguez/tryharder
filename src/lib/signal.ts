import { CancellationError, TimeoutError } from "./errors"

export interface SignalController {
  signal?: AbortSignal
  checkDidCancel(cause?: unknown): CancellationError | undefined
  raceWithSignal<V>(promise: PromiseLike<V>, cause?: unknown): Promise<V | CancellationError>
  [Symbol.dispose](): void
  dispose(): void
}

function returnUndefinedCancellation(): CancellationError | undefined {
  return undefined
}

function disposeNoop(): void {
  void 0
}

function passthroughPromise<V>(promise: PromiseLike<V>): Promise<V> {
  return Promise.resolve(promise)
}

function checkIsSignalArray(
  value: AbortSignal | readonly AbortSignal[]
): value is readonly AbortSignal[] {
  return Array.isArray(value)
}

function normalizeSignals(signals?: AbortSignal | readonly AbortSignal[]): AbortSignal[] {
  if (!signals) {
    return []
  }

  if (checkIsSignalArray(signals)) {
    return [...signals]
  }

  return [signals]
}

export function createSignalController(
  signals?: AbortSignal | readonly AbortSignal[]
): SignalController {
  const sources = normalizeSignals(signals)

  if (sources.length === 0) {
    return {
      checkDidCancel: returnUndefinedCancellation,
      dispose: disposeNoop,
      raceWithSignal: passthroughPromise,
      [Symbol.dispose]: disposeNoop,
    }
  }

  const internalController = new AbortController()
  const cleanupFns: Array<() => void> = []

  for (const source of sources) {
    const abortFromSource = (): void => {
      internalController.abort(source.reason)
    }

    if (source.aborted) {
      internalController.abort(source.reason)
      break
    }

    source.addEventListener("abort", abortFromSource, { once: true })
    cleanupFns.push(() => {
      source.removeEventListener("abort", abortFromSource)
    })
  }

  function createCancellationError(cause?: unknown): CancellationError {
    return new CancellationError({ cause: cause ?? internalController.signal.reason })
  }

  function checkDidCancel(cause?: unknown): CancellationError | undefined {
    if (!internalController.signal.aborted) {
      return undefined
    }

    if (internalController.signal.reason instanceof TimeoutError) {
      return undefined
    }

    return createCancellationError(cause)
  }

  async function raceWithSignal<V>(
    promise: PromiseLike<V>,
    cause?: unknown
  ): Promise<V | CancellationError> {
    const cancelled = checkDidCancel(cause)

    if (cancelled) {
      return cancelled
    }

    let removeAbortListener: (() => void) | undefined

    const cancellationPromise = new Promise<CancellationError>((resolve) => {
      const onAbort = () => {
        resolve(createCancellationError(cause))
      }

      internalController.signal.addEventListener("abort", onAbort, { once: true })
      removeAbortListener = () => {
        internalController.signal.removeEventListener("abort", onAbort)
      }
    })

    try {
      return await Promise.race([Promise.resolve(promise), cancellationPromise])
    } finally {
      removeAbortListener?.()
    }
  }

  function dispose(): void {
    for (const cleanup of cleanupFns) {
      cleanup()
    }
  }

  return {
    checkDidCancel,
    dispose,
    raceWithSignal,
    signal: internalController.signal,
    [Symbol.dispose]: dispose,
  }
}
