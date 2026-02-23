import { checkIsPromiseLike } from "./utils"

type GenUnwrap<T> = Exclude<Awaited<T>, Error>
type GenUse = <T>(value: T) => Generator<T, GenUnwrap<T>, GenUnwrap<T>>

type GenErrors<TYield> = Extract<Awaited<TYield>, Error>
type GenValue<TYield, TReturn> = Awaited<TReturn> | GenErrors<TYield>
type CheckIsAsync<TYield, TReturn> =
  Extract<TYield | TReturn, PromiseLike<unknown>> extends never ? false : true

type GenResult<TYield, TReturn> =
  CheckIsAsync<TYield, TReturn> extends true
    ? Promise<GenValue<TYield, TReturn>>
    : GenValue<TYield, TReturn>

function* use<T>(value: T): Generator<T, GenUnwrap<T>, GenUnwrap<T>> {
  return yield value
}

async function executeAsyncGenerator<TYield, TReturn>(
  iterator: Generator<TYield, TReturn, unknown>,
  initialValue: PromiseLike<unknown>
): Promise<GenValue<TYield, TReturn>> {
  let currentValue: unknown = await initialValue

  if (currentValue instanceof Error) {
    return currentValue as GenErrors<TYield>
  }

  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    const step = iterator.next(currentValue)

    if (step.done) {
      if (checkIsPromiseLike(step.value)) {
        // oxlint-disable-next-line no-await-in-loop
        return (await step.value) as Awaited<TReturn>
      }

      return step.value as Awaited<TReturn>
    }

    if (checkIsPromiseLike(step.value)) {
      // oxlint-disable-next-line no-await-in-loop
      currentValue = await step.value
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
      return executeAsyncGenerator(iterator, step.value) as GenResult<TYield, TReturn>
    }

    if (step.value instanceof Error) {
      return step.value as GenResult<TYield, TReturn>
    }

    currentValue = step.value
  }
}
