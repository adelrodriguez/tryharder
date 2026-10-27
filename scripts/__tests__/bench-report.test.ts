import { describe, expect, it } from "vitest"
import {
  normalizeBenchmarkPayload,
  parseRawBenchmarkPayload,
  renderBenchmarkSummary,
} from "../bench-report"

const meta = {
  arch: "arm64",
  cpuModel: "Test CPU",
  date: "2026-03-07T00:00:00.000Z",
  gitSha: "abc123",
  nodeVersion: "v24.0.0",
  platform: "darwin",
}

function report(benchmarks: unknown[]) {
  return { testResults: [{ assertionResults: [{ benchmarks }] }] }
}

describe("benchmark reporting", () => {
  it("normalizes Vitest JSON reports into artifact output", () => {
    const payload = parseRawBenchmarkPayload(
      JSON.stringify({
        testResults: [
          {
            assertionResults: [
              {
                benchmarks: [
                  {
                    name: "runSync",
                    tasks: [
                      {
                        latency: { mean: 0.000125, samplesCount: 3 },
                        name: "runSync/function/success",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            assertionResults: [
              {
                benchmarks: [
                  {
                    name: "all",
                    tasks: [
                      {
                        latency: { mean: 0.00025, samplesCount: 2 },
                        name: "all/two-independent-sync-tasks",
                      },
                    ],
                  },
                ],
              },
              { benchmarks: [] },
            ],
          },
        ],
      })
    )

    expect(normalizeBenchmarkPayload(payload, meta)).toEqual({
      cases: [
        {
          avgNs: 125,
          group: "runSync",
          hz: 8_000_000,
          name: "runSync/function/success",
          samples: 3,
        },
        {
          avgNs: 250,
          group: "all",
          hz: 4_000_000,
          name: "all/two-independent-sync-tasks",
          samples: 2,
        },
      ],
      meta: { ...meta, suiteVersion: 4 },
    })
  })

  it("throws when benchmark fields are missing", () => {
    expect(() =>
      normalizeBenchmarkPayload(
        report([{ name: "runSync", tasks: [{ latency: { mean: 0.000125, samplesCount: 1 } }] }])
      )
    ).toThrow("Benchmark task is missing name")
  })

  it("throws when the report has no test results", () => {
    expect(() => normalizeBenchmarkPayload({})).toThrow("Benchmark payload is missing testResults")
  })

  it("supports empty benchmark results", () => {
    const artifact = normalizeBenchmarkPayload({ testResults: [] }, meta)

    expect(artifact.cases).toEqual([])
    expect(renderBenchmarkSummary(artifact)).toContain("No benchmark cases were produced.")
  })

  it("throws on non-finite numeric values", () => {
    expect(() =>
      normalizeBenchmarkPayload(
        report([
          {
            name: "runSync",
            tasks: [
              {
                latency: { mean: Number.POSITIVE_INFINITY, samplesCount: 1 },
                name: "runSync/function/success",
              },
            ],
          },
        ])
      )
    ).toThrow("Benchmark runSync/function/success is missing mean")
  })
})
