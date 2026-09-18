import { describe, expect, it } from "vitest"
import {
  normalizeBenchmarkPayload,
  parseRawBenchmarkPayload,
  renderBenchmarkSummary,
} from "../report"

describe("benchmark reporting", () => {
  it("normalizes benchmark payloads into artifact output", () => {
    const payload = parseRawBenchmarkPayload(
      JSON.stringify({
        groups: {
          "all/two-independent-sync-tasks": "orchestration",
          "runSync/function/success": "core",
        },
        results: {
          benchmarks: [
            {
              runs: [
                {
                  name: "runSync/function/success",
                  stats: {
                    avg: 125,
                    samples: [100, 125, 150],
                  },
                },
              ],
            },
            {
              runs: [
                {
                  name: "all/two-independent-sync-tasks",
                  stats: {
                    avg: 250,
                    samples: [200, 250],
                  },
                },
              ],
            },
          ],
          context: {
            cpu: {
              name: "Test CPU",
            },
            version: "v24.0.0",
          },
        },
        suiteVersion: 1,
      })
    )

    const artifact = normalizeBenchmarkPayload(payload, {
      arch: "arm64",
      date: "2026-03-07T00:00:00.000Z",
      gitSha: "abc123",
      platform: "darwin",
    })

    expect(artifact).toEqual({
      cases: [
        {
          avgNs: 125,
          group: "core",
          hz: 8_000_000,
          name: "runSync/function/success",
          samples: 3,
        },
        {
          avgNs: 250,
          group: "orchestration",
          hz: 4_000_000,
          name: "all/two-independent-sync-tasks",
          samples: 2,
        },
      ],
      meta: {
        arch: "arm64",
        cpuModel: "Test CPU",
        date: "2026-03-07T00:00:00.000Z",
        gitSha: "abc123",
        nodeVersion: "v24.0.0",
        platform: "darwin",
        suiteVersion: 1,
      },
    })
  })

  it("throws when benchmark fields are missing", () => {
    expect(() =>
      normalizeBenchmarkPayload({
        groups: {},
        results: {
          benchmarks: [
            {
              runs: [
                {
                  stats: {
                    avg: 125,
                    samples: [100],
                  },
                },
              ],
            },
          ],
        },
      })
    ).toThrow("Benchmark run is missing name")
  })

  it("supports empty benchmark results", () => {
    const artifact = normalizeBenchmarkPayload(
      {
        groups: {},
        results: {
          benchmarks: [],
          context: {},
        },
      },
      {
        arch: "arm64",
        date: "2026-03-07T00:00:00.000Z",
        gitSha: "abc123",
        nodeVersion: "v24.0.0",
        platform: "darwin",
      }
    )

    expect(artifact.cases).toEqual([])
    expect(renderBenchmarkSummary(artifact)).toContain("No benchmark cases were produced.")
  })

  it("throws on non-finite numeric values", () => {
    expect(() =>
      normalizeBenchmarkPayload({
        groups: {
          "runSync/function/success": "core",
        },
        results: {
          benchmarks: [
            {
              runs: [
                {
                  name: "runSync/function/success",
                  stats: {
                    avg: Number.POSITIVE_INFINITY,
                    samples: [100],
                  },
                },
              ],
            },
          ],
        },
      })
    ).toThrow("Benchmark runSync/function/success is missing stats.avg")
  })
})
