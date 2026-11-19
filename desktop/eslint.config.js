import js from "@eslint/js"
import prettierConfig from "eslint-config-prettier"
import prettier from "eslint-plugin-prettier"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {ignores: ["dist/**", "src-tauri/**", "media/**", "target/**", "node_modules/**"]},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {globals: {...globals.browser}},
    plugins: {"react-hooks": reactHooks, prettier},
    rules: {
      ...reactHooks.configs.recommended.rules,
      "prettier/prettier": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": ["error", {patterns: [{group: ["../*"], message: "Use @/ path aliases."}]}],
    },
  },
)
