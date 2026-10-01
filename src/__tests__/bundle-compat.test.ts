import { spawnSync } from "node:child_process"
import { readdir, readFile, rm } from "node:fs/promises"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

async function findJavaScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name)

      if (entry.isDirectory()) {
        return await findJavaScriptFiles(path)
      }

      return entry.isFile() && path.endsWith(".js") ? [path] : []
    })
  )

  return files.flat()
}

describe("bundle compatibility", () => {
  it("builds a browser-safe bundle that runs on the minimum supported runtime", async () => {
    const outDirName = `.tmp-bundle-compat-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const outDir = join(process.cwd(), outDirName)

    try {
      const build = spawnSync(
        process.execPath,
        [
          fileURLToPath(import.meta.resolve("tsdown/run")),
          "--platform",
          "browser",
          "--out-dir",
          outDirName,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
        }
      )

      if (build.status !== 0) {
        throw build.error ?? new Error(build.stderr || build.stdout)
      }

      const jsFiles = await findJavaScriptFiles(outDir)
      expect(jsFiles.map((path) => relative(outDir, path))).toEqual(
        expect.arrayContaining(["errors.js", "index.js", "types.js"])
      )

      const contents = await Promise.all(jsFiles.map((path) => readFile(path, "utf8")))

      for (const content of contents) {
        expect(content).not.toMatch(/(?:from|import|require)\s*\(?\s*["']node:/)
        expect(content).not.toContain("new DisposableStack")
        expect(content).not.toContain("new AsyncDisposableStack")
      }

      const smoke = spawnSync(process.execPath, ["scripts/compat-smoke.mjs", outDirName], {
        cwd: process.cwd(),
        encoding: "utf8",
      })

      if (smoke.status !== 0) {
        throw smoke.error ?? new Error(smoke.stderr || smoke.stdout)
      }
    } finally {
      await rm(outDir, { force: true, recursive: true })
    }
  }, 30_000)
})
