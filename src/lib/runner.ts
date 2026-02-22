import type { BuilderConfig, RunInput, RunTryFn, RunWithCatchOptions } from "./types"
import { createContext } from "./context"
import { Panic, UnhandledException } from "./errors"

export function executeRun<T>(config: BuilderConfig, input: RunTryFn<T>): T | UnhandledException
export function executeRun<T, E>(config: BuilderConfig, input: RunWithCatchOptions<T, E>): T | E
export function executeRun<T, E>(
  config: BuilderConfig,
  input: RunInput<T, E>
): T | E | UnhandledException
export function executeRun<T, E>(config: BuilderConfig, input: RunInput<T, E>) {
  const ctx = createContext(config)

  if (typeof input === "function") {
    try {
      return input(ctx)
    } catch (error) {
      return new UnhandledException({ cause: error })
    }
  }

  try {
    return input.try(ctx)
  } catch (error) {
    try {
      return input.catch(error)
    } catch (catchError) {
      throw new Panic({ cause: catchError })
    }
  }
}
