import { run } from "mitata"
import { BENCHMARK_SUITE_VERSION } from "./constants"
import { getBenchmarkGroups } from "./shared"
import { registerCoreBenchmarks } from "./suites/core.bench"
import { registerOrchestrationBenchmarks } from "./suites/orchestration.bench"
import { registerPoliciesBenchmarks } from "./suites/policies.bench"

registerCoreBenchmarks()
registerPoliciesBenchmarks()
registerOrchestrationBenchmarks()

const suppressPrint = () => null
const isJson = process.argv.includes("--json")
const results = await run({
  colors: !isJson,
  format: isJson ? "quiet" : "mitata",
  print: isJson ? suppressPrint : undefined,
  throw: true,
})

if (isJson) {
  process.stdout.write(
    `${JSON.stringify({
      groups: getBenchmarkGroups(),
      results: {
        benchmarks: results.benchmarks.map((trial) => ({
          runs: trial.runs.map((run) => ({
            error: run.error,
            name: run.name,
            stats:
              run.stats === undefined
                ? undefined
                : {
                    avg: run.stats.avg,
                    samples: run.stats.samples.length,
                  },
          })),
        })),
        context: {
          cpu: {
            name: results.context.cpu.name,
          },
          version: process.version,
        },
      },
      suiteVersion: BENCHMARK_SUITE_VERSION,
    })}\n`
  )
}
