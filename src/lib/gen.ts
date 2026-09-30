import { checkIsPromiseLike } from "./utils"

type GenUnwrap<T> = Exclude<Awaited<T>, Error>
export type GenUse = <T>(value: T) => Generator<T, GenUnwrap<T>, GenUnwrap<T>>

type GenErrors<TYield> = Extract<Awaited<TYield>, Error>
type CheckIsAsync<TYield, TReturn> =
  Extract<TYield | TReturn, PromiseLike<unknown>> extends never ? false : true

export type GenResult<TYield, TReturn> =
  CheckIsAsync<TYield, TReturn> extends true
    ? Promise<Awaited<TReturn> | GenErrors<TYield>>
    : Awaited<TReturn> | GenErrors<TYield>

function* use<T>(value: T): Generator<T, GenUnwrap<T>, GenUnwrap<T>> {
  return yield value
}

/**
 * Runs the generator's `finally` blocks after a short-circuit. Cleanup may itself yield, so keep
 * resuming it (awaiting yielded promises) until the generator is done, then report `result`.
 */
async function closeAsync<TYield, TReturn, R>(
  iterator: Generator<TYield, TReturn, unknown>,
  initialStep: IteratorResult<TYield, TReturn>,
  result: R
): Promise<R> {
  let currentStep = initialStep

  while (!currentStep.done) {
    let currentValue: unknown

    try {
      // oxlint-disable-next-line no-await-in-loop
      currentValue = await currentStep.value
    } catch (error) {
      currentStep = iterator.throw(error)
      continue
    }

    currentStep = iterator.next(currentValue)
  }

  return result
}

/**
 * Sync counterpart of {@link closeAsync}: stays sync unless cleanup yields a promise, then hands the
 * remaining cleanup to {@link closeAsync}.
 */
function close<TYield, TReturn, R>(
  iterator: Generator<TYield, TReturn, unknown>,
  result: R
): R | Promise<R> {
  let currentStep = iterator.return(undefined as TReturn)

  while (!currentStep.done) {
    if (checkIsPromiseLike(currentStep.value)) {
      return closeAsync(iterator, currentStep, result)
    }

    currentStep = iterator.next(currentStep.value)
  }

  return result
}

async function executeAsyncGenerator<TYield, TReturn>(
  iterator: Generator<TYield, TReturn, unknown>,
  initialStep: IteratorResult<TYield, TReturn>
): Promise<Awaited<TReturn> | GenErrors<TYield>> {
  let currentStep = initialStep

  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    if (currentStep.done) {
      if (checkIsPromiseLike(currentStep.value)) {
        // oxlint-disable-next-line no-await-in-loop
        return await currentStep.value
      }

      return currentStep.value as Awaited<TReturn>
    }

    let currentValue: unknown

    if (checkIsPromiseLike(currentStep.value)) {
      try {
        // oxlint-disable-next-line no-await-in-loop
        currentValue = await currentStep.value
      } catch (error) {
        currentStep = iterator.throw(error)
        continue
      }
    } else {
      currentValue = currentStep.value
    }

    if (currentValue instanceof Error) {
      // oxlint-disable-next-line no-await-in-loop
      return await close(iterator, currentValue as GenErrors<TYield>)
    }

    currentStep = iterator.next(currentValue)
  }
}

export function driveGen<TYield, TReturn>(
  factory: (useFn: GenUse) => Generator<TYield, TReturn, unknown>
): GenResult<TYield, TReturn> {
  const iterator = factory(use)

  let currentValue: unknown = undefined

  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    const step = iterator.next(currentValue)

    if (step.done) {
      if (checkIsPromiseLike(step.value)) {
        return Promise.resolve(step.value) as GenResult<TYield, TReturn>
      }

      return step.value as GenResult<TYield, TReturn>
    }

    if (checkIsPromiseLike(step.value)) {
      return executeAsyncGenerator(iterator, step) as GenResult<TYield, TReturn>
    }

    if (step.value instanceof Error) {
      return close(iterator, step.value) as GenResult<TYield, TReturn>
    }

    currentValue = step.value
  }
}
