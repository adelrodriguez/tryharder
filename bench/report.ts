import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { BENCHMARK_SUITE_VERSION } from "./constants"

const OUTPUT_DIR = "bench-results"
const LATEST_REPORT_PATH = join(OUTPUT_DIR, "latest.json")
const SUMMARY_PATH = join(OUTPUT_DIR, "summary.md")

type RawMitataRun = {
  error?: unknown
  name?: unknown
  stats?: {
    avg?: unknown
    samples?: unknown
  }
}

type RawMitataTrial = {
  runs?: unknown
}

type RawMitataContext = {
  cpu?: {
    name?: unknown
  }
  version?: unknown
}

type RawBenchmarkPayload = {
  groups?: Record<string, unknown>
  results?: {
    benchmarks?: unknown
    context?: RawMitataContext
  }
  suiteVersion?: unknown
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
    bunVersion: string
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
    bunVersion?: string
    cpuModel?: string | null
    date?: string
    gitSha?: string | null
    platform?: string
  } = {}
): BenchmarkArtifact {
  const suiteVersion = normalizeSuiteVersion(payload.suiteVersion)
  const groups = payload.groups
  const trials = normalizeTrials(payload.results?.benchmarks)

  const cases = trials.flatMap((trial) => trial.runs.map((run) => normalizeRun(run, groups)))

  return {
    cases,
    meta: {
      arch: options.arch ?? process.arch,
      bunVersion:
        options.bunVersion ??
        normalizeOptionalString(payload.results?.context?.version) ??
        Bun.version,
      cpuModel:
        options.cpuModel ?? normalizeOptionalString(payload.results?.context?.cpu?.name) ?? null,
      date: options.date ?? new Date().toISOString(),
      gitSha: options.gitSha ?? getGitSha(),
      platform: options.platform ?? process.platform,
      suiteVersion,
    },
  }
}

export function renderBenchmarkSummary(artifact: BenchmarkArtifact) {
  const lines = [
    "# Benchmark Summary",
    "",
    `- Date: ${artifact.meta.date}`,
    `- Git SHA: ${artifact.meta.gitSha ?? "unknown"}`,
    `- Bun: ${artifact.meta.bunVersion}`,
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
  const rawInput = await readStdin()
  const artifact = normalizeBenchmarkPayload(parseRawBenchmarkPayload(rawInput))
  const result = await writeBenchmarkArtifacts(artifact)

  process.stdout.write(result.summary)
}

function normalizeSuiteVersion(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value
  }

  return BENCHMARK_SUITE_VERSION
}

function normalizeTrials(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Benchmark payload is missing results.benchmarks")
  }

  return value.map((trial, index) => {
    if (!isRecord(trial) || !Array.isArray(trial.runs)) {
      throw new Error(`Benchmark trial at index ${index} is missing runs`)
    }

    return trial as RawMitataTrial & { runs: RawMitataRun[] }
  })
}

function normalizeRun(run: RawMitataRun, groups: Record<string, unknown> | undefined) {
  if (run.error !== undefined) {
    throw new Error(`Benchmark ${describeRunName(run.name)} failed`)
  }

  const name = normalizeRequiredString(run.name, "Benchmark run is missing name")
  const avgNs = normalizeFiniteNumber(run.stats?.avg, `Benchmark ${name} is missing stats.avg`)
  const samplesValue = run.stats?.samples
  const samples = Array.isArray(samplesValue)
    ? samplesValue.length
    : normalizeFiniteNumber(samplesValue, `Benchmark ${name} is missing stats.samples`)

  return {
    avgNs,
    group: normalizeBenchmarkGroup(name, groups),
    hz: 1e9 / avgNs,
    name,
    samples,
  }
}

function normalizeBenchmarkGroup(name: string, groups: Record<string, unknown> | undefined) {
  const group = groups?.[name]

  if (typeof group === "string" && group.length > 0) {
    return group
  }

  return "unknown"
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

function describeRunName(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : "unknown"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function readStdin() {
  return await new Response(Bun.stdin.stream()).text()
}

function getGitSha() {
  const gitSha = process.env.GITHUB_SHA

  if (gitSha && gitSha.length > 0) {
    return gitSha
  }

  const result = Bun.spawnSync({
    cmd: ["git", "rev-parse", "HEAD"],
    stderr: "ignore",
    stdout: "pipe",
  })

  if (result.exitCode !== 0) {
    return null
  }

  const value = result.stdout.toString().trim()
  return value.length > 0 ? value : null
}
