import { spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { cpus } from "node:os"
import { join } from "node:path"

const BENCHMARK_SUITE_VERSION = 4
const OUTPUT_DIR = "bench-results"
const VITEST_REPORT_PATH = join(OUTPUT_DIR, "vitest.json")
const LATEST_REPORT_PATH = join(OUTPUT_DIR, "latest.json")
const SUMMARY_PATH = join(OUTPUT_DIR, "summary.md")

type RawBenchmarkTask = {
  latency?: {
    mean?: unknown
    samplesCount?: unknown
  }
  name?: unknown
}

type RawBenchmark = {
  name?: unknown
  tasks?: unknown
}

type RawBenchmarkPayload = {
  testResults?: unknown
}

export type BenchmarkCase = {
  avgNs: number
  group: string
  hz: number
  name: string
  samples: number
}

export type BenchmarkArtifact = {
  cases: BenchmarkCase[]
  meta: {
    arch: string
    nodeVersion: string
    cpuModel: string | null
    date: string
    gitSha: string | null
    platform: string
    suiteVersion: number
  }
}

export function parseRawBenchmarkPayload(text: string) {
  return JSON.parse(text) as RawBenchmarkPayload
}

export function normalizeBenchmarkPayload(
  payload: RawBenchmarkPayload,
  options: {
    arch?: string
    nodeVersion?: string
    cpuModel?: string | null
    date?: string
    gitSha?: string | null
    platform?: string
  } = {}
): BenchmarkArtifact {
  const cases = normalizeBenchmarks(payload.testResults).flatMap((benchmark) =>
    benchmark.tasks.map((task) => normalizeTask(task, benchmark.name))
  )

  return {
    cases,
    meta: {
      arch: options.arch ?? process.arch,
      cpuModel: options.cpuModel ?? cpus()[0]?.model ?? null,
      date: options.date ?? new Date().toISOString(),
      gitSha: options.gitSha ?? getGitSha(),
      nodeVersion: options.nodeVersion ?? process.version,
      platform: options.platform ?? process.platform,
      suiteVersion: BENCHMARK_SUITE_VERSION,
    },
  }
}

export function renderBenchmarkSummary(artifact: BenchmarkArtifact) {
  const lines = [
    "# Benchmark Summary",
    "",
    `- Date: ${artifact.meta.date}`,
    `- Git SHA: ${artifact.meta.gitSha ?? "unknown"}`,
    `- Node.js: ${artifact.meta.nodeVersion}`,
    `- Platform: ${artifact.meta.platform} (${artifact.meta.arch})`,
    `- CPU: ${artifact.meta.cpuModel ?? "unknown"}`,
    `- Suite version: ${artifact.meta.suiteVersion}`,
    "",
  ]

  if (artifact.cases.length === 0) {
    lines.push("No benchmark cases were produced.")
    return lines.join("\n")
  }

  lines.push("| Group | Name | Avg ns/iter | Hz | Samples |", "| --- | --- | ---: | ---: | ---: |")

  for (const benchmarkCase of artifact.cases.toSorted(compareBenchmarkCases)) {
    lines.push(
      `| ${benchmarkCase.group} | ${benchmarkCase.name} | ${benchmarkCase.avgNs.toFixed(2)} | ${benchmarkCase.hz.toFixed(2)} | ${benchmarkCase.samples} |`
    )
  }

  return lines.join("\n")
}

export async function writeBenchmarkArtifacts(artifact: BenchmarkArtifact) {
  await mkdir(OUTPUT_DIR, { recursive: true })

  const summary = renderBenchmarkSummary(artifact)

  await Promise.all([
    writeFile(LATEST_REPORT_PATH, `${JSON.stringify(artifact, null, 2)}\n`),
    writeFile(SUMMARY_PATH, `${summary}\n`),
  ])

  return {
    latestPath: LATEST_REPORT_PATH,
    summary,
    summaryPath: SUMMARY_PATH,
  }
}

if (import.meta.main) {
  const rawInput = await readFile(VITEST_REPORT_PATH, "utf8")
  const artifact = normalizeBenchmarkPayload(parseRawBenchmarkPayload(rawInput))
  const result = await writeBenchmarkArtifacts(artifact)

  process.stdout.write(result.summary)
}

function normalizeBenchmarks(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Benchmark payload is missing testResults")
  }

  return value.flatMap((file) => {
    if (!isRecord(file) || !Array.isArray(file.assertionResults)) {
      throw new Error("Benchmark test file is missing assertionResults")
    }

    return file.assertionResults.flatMap((test) =>
      isRecord(test) && Array.isArray(test.benchmarks)
        ? test.benchmarks.map((benchmark: RawBenchmark) => {
            if (!Array.isArray(benchmark.tasks)) {
              throw new Error(`Benchmark ${describeName(benchmark.name)} is missing tasks`)
            }

            return {
              name: normalizeRequiredString(benchmark.name, "Benchmark is missing name"),
              tasks: benchmark.tasks as RawBenchmarkTask[],
            }
          })
        : []
    )
  })
}

function normalizeTask(task: RawBenchmarkTask, group: string) {
  const name = normalizeRequiredString(task.name, "Benchmark task is missing name")
  const meanMs = normalizeFiniteNumber(task.latency?.mean, `Benchmark ${name} is missing mean`)
  const samples = normalizeFiniteNumber(
    task.latency?.samplesCount,
    `Benchmark ${name} is missing samplesCount`
  )
  const avgNs = meanMs * 1e6

  return {
    avgNs,
    group,
    hz: 1e9 / avgNs,
    name,
    samples,
  }
}

function normalizeRequiredString(value: unknown, message: string) {
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  throw new Error(message)
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function normalizeFiniteNumber(value: unknown, message: string) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  throw new Error(message)
}

function compareBenchmarkCases(left: BenchmarkCase, right: BenchmarkCase) {
  return left.group.localeCompare(right.group) || left.name.localeCompare(right.name)
}

function describeName(value: unknown) {
  return normalizeOptionalString(value) ?? "unknown"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getGitSha() {
  const gitSha = process.env.GITHUB_SHA

  if (gitSha && gitSha.length > 0) {
    return gitSha
  }

  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })

  if (result.status !== 0) {
    return null
  }

  const value = result.stdout.trim()
  return value.length > 0 ? value : null
}
