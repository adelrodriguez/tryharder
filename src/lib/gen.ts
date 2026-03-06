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

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error("Non-error thrown in gen", { cause: error })
}

async function executeAsyncGenerator<TYield, TReturn>(
  iterator: Generator<TYield, TReturn, unknown>,
  initialValue: PromiseLike<unknown>
): Promise<Awaited<TReturn> | GenErrors<TYield>> {
  let currentValue: unknown

  try {
    currentValue = await initialValue
  } catch (error) {
    return normalizeError(error) as GenErrors<TYield>
  }

  if (currentValue instanceof Error) {
    return currentValue as GenErrors<TYield>
  }

  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    let step: IteratorResult<TYield, TReturn>

    try {
      step = iterator.next(currentValue)
    } catch (error) {
      return normalizeError(error) as GenErrors<TYield>
    }

    if (step.done) {
      if (checkIsPromiseLike(step.value)) {
        try {
          // oxlint-disable-next-line no-await-in-loop
          return (await step.value) as Awaited<TReturn>
        } catch (error) {
          return normalizeError(error) as GenErrors<TYield>
        }
      }

      return step.value as Awaited<TReturn>
    }

    if (checkIsPromiseLike(step.value)) {
      try {
        // oxlint-disable-next-line no-await-in-loop
        currentValue = await step.value
      } catch (error) {
        return normalizeError(error) as GenErrors<TYield>
      }
    } else {
      currentValue = step.value
    }

    if (currentValue instanceof Error) {
      return currentValue as GenErrors<TYield>
    }
  }
}

export function executeGen<TYield, TReturn>(
  factory: (useFn: GenUse) => Generator<TYield, TReturn, unknown>
): GenResult<TYield, TReturn> {
  let iterator: Generator<TYield, TReturn, unknown>

  try {
    iterator = factory(use)
  } catch (error) {
    return normalizeError(error) as GenResult<TYield, TReturn>
  }

  let currentValue: unknown = undefined

  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    let step: IteratorResult<TYield, TReturn>

    try {
      step = iterator.next(currentValue)
    } catch (error) {
      return normalizeError(error) as GenResult<TYield, TReturn>
    }

    if (step.done) {
      if (checkIsPromiseLike(step.value)) {
        return Promise.resolve(step.value) as GenResult<TYield, TReturn>
      }

      return step.value as GenResult<TYield, TReturn>
    }

    if (checkIsPromiseLike(step.value)) {
      return executeAsyncGenerator(iterator, step.value) as GenResult<TYield, TReturn>
    }

    if (step.value instanceof Error) {
      return step.value as GenResult<TYield, TReturn>
    }

    currentValue = step.value
  }
}
