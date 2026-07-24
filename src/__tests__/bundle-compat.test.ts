import { describe, expect, it } from "bun:test"
import { readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

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
  it("builds a browser-safe bundle that runs without native disposable stack globals", async () => {
    const outDirName = `.tmp-bundle-compat-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const outDir = join(process.cwd(), outDirName)

    try {
      const build = Bun.spawnSync({
        cmd: ["bun", "x", "bunup", "--target", "browser", "--out-dir", outDirName],
        cwd: process.cwd(),
        stderr: "pipe",
        stdout: "pipe",
      })

      if (build.exitCode !== 0) {
        throw new Error(build.stderr.toString() || build.stdout.toString())
      }

      const jsFiles = await findJavaScriptFiles(outDir)
      expect(jsFiles.length > 0).toBe(true)

      const contents = await Promise.all(jsFiles.map((path) => readFile(path, "utf8")))

      for (const content of contents) {
        expect(/from\s*["']node:/.test(content)).toBe(false)
        expect(content.includes("new DisposableStack")).toBe(false)
        expect(content.includes("new AsyncDisposableStack")).toBe(false)
      }

      const smokePath = join(outDir, "smoke.mjs")
      const entrypoint = pathToFileURL(join(outDir, "index.js")).href

      await writeFile(
        smokePath,
        [
          "globalThis.DisposableStack = undefined",
          "globalThis.AsyncDisposableStack = undefined",
          "const NativeSymbol = globalThis.Symbol",
          "const SymbolShim = function (description) { return NativeSymbol(description) }",
          "const symbolDescriptors = Object.getOwnPropertyDescriptors(NativeSymbol)",
          "delete symbolDescriptors.dispose",
          "delete symbolDescriptors.asyncDispose",
          "Object.defineProperties(SymbolShim, symbolDescriptors)",
          "Object.defineProperty(SymbolShim, 'dispose', { value: undefined, writable: true, configurable: true })",
          "Object.defineProperty(SymbolShim, 'asyncDispose', { value: undefined, writable: true, configurable: true })",
          "globalThis.Symbol = SymbolShim",
          `const try$ = await import(${JSON.stringify(entrypoint)})`,
          "const runResult = await try$.run(() => 1)",
          'if (runResult !== 1) throw new Error("run() smoke test failed")',
          "const allResult = await try$.all({ a() { return 1 } })",
          'if (allResult.a !== 1) throw new Error("all() smoke test failed")',
          'const flowResult = await try$.flow({ a() { return this.$exit("done") } })',
          'if (flowResult !== "done") throw new Error("flow() smoke test failed")',
          "let cleaned = false",
          "const disposer = try$.disposer()",
          "disposer.defer(() => { cleaned = true })",
          "await disposer.dispose()",
          'if (!cleaned) throw new Error("disposer() smoke test failed")',
        ].join("\n")
      )

      const smoke = Bun.spawnSync({
        cmd: ["bun", smokePath],
        cwd: process.cwd(),
        stderr: "pipe",
        stdout: "pipe",
      })

      if (smoke.exitCode !== 0) {
        throw new Error(smoke.stderr.toString() || smoke.stdout.toString())
      }
    } finally {
      await rm(outDir, { force: true, recursive: true })
    }
  })
})
