import { bench, do_not_optimize } from "mitata"

export * as try$ from "../src/index"

type BenchmarkGroup = "core" | "orchestration" | "policies"

const benchmarkGroups = new Map<string, BenchmarkGroup>()

let blackhole: unknown

export function consume<T>(value: T) {
  blackhole = value
  do_not_optimize(blackhole)
  return value
}

export function registerBenchmark(group: BenchmarkGroup, name: string, fn: () => unknown) {
  assertUniqueBenchmarkName(group, name)
  return bench(name, fn).gc("once")
}

export function registerAsyncBenchmark(
  group: BenchmarkGroup,
  name: string,
  fn: () => Promise<unknown>
) {
  assertUniqueBenchmarkName(group, name)
  return bench(name, fn).gc("once")
}

export function getBenchmarkGroups() {
  return Object.fromEntries(benchmarkGroups)
}

function assertUniqueBenchmarkName(group: BenchmarkGroup, name: string) {
  if (benchmarkGroups.has(name)) {
    throw new Error(`Duplicate benchmark name: ${name}`)
  }

  benchmarkGroups.set(name, group)
}
