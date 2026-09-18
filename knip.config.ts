import type { KnipConfig } from "knip"
import analyze from "adamantite/analyze"

const config: KnipConfig = {
  ...analyze,
  entry: ["scripts/*.ts"],
  ignoreExportsUsedInFile: true,
  project: ["*.config.ts", "bench/**/*.ts", "scripts/**/*.ts", "src/**/*.ts"],
  rules: {
    ...analyze.rules,
    binaries: "error",
    dependencies: "error",
    devDependencies: "off",
    duplicates: "warn",
    enumMembers: "off",
    exports: "warn",
    files: "error",
    namespaceMembers: "warn",
    optionalPeerDependencies: "warn",
    types: "warn",
    unlisted: "error",
    unresolved: "error",
  },
}

export default config
