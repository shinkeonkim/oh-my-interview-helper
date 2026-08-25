import eslint from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import vuePlugin from "eslint-plugin-vue"
import globals from "globals"
import tseslint from "typescript-eslint"
import vueParser from "vue-eslint-parser"

export default [
  {
    ignores: [
      ".omo/evidence/**",
      "client/dist/**",
      "node_modules/**",
      "server/dist/**",
      "server/public/**"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vuePlugin.configs["flat/recommended"],
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: "module"
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Use an as const object and literal union instead of enum."
        },
        {
          selector: "TSAsExpression > TSAnyKeyword",
          message: "Do not assert a value as any."
        }
      ]
    }
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      globals: globals.browser,
      parserOptions: {
        extraFileExtensions: [".vue"],
        parser: tseslint.parser,
        sourceType: "module"
      }
    }
  },
  {
    files: ["client/src/components/ui/**/*.vue"],
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/require-default-prop": "off"
    }
  },
  eslintConfigPrettier
]
