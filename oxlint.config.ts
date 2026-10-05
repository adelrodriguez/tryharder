import core from "adamantite/lint"
import { defineConfig } from "oxlint"

export default defineConfig({
  extends: [core],
  options: {
    respectEslintDisableDirectives: true,
    typeAware: true,
    typeCheck: true,
  },
  overrides: [
    {
      // JSDoc is the only type syntax available in plain JavaScript files.
      files: ["scripts/**/*.mjs"],
      rules: { "jsdoc/check-tag-names": ["error", { typed: false }] },
    },
    {
      // Bare blocks scope each case's type aliases; Equal needs its identity type parameter.
      files: ["src/__tests__/types.test-d.ts"],
      rules: {
        "no-lone-blocks": "off",
        "typescript/no-unnecessary-type-parameters": "off",
      },
    },
  ],
})
