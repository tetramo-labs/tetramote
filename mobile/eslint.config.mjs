import {defineConfig} from "eslint/config"
import expoConfig from "eslint-config-expo/flat.js"
import prettierConfig from "eslint-config-prettier"
import pluginI18next from "eslint-plugin-i18next"
import pluginPrettier from "eslint-plugin-prettier"
import pluginReactNative from "eslint-plugin-react-native"

const restrictedImportPaths = [
  {
    name: "expo-router",
    importNames: ["useRouter", "router"],
    message: "Navigate through useNavigationStore from @/stores/navigation.",
  },
  {
    name: "react-native",
    importNames: ["Text"],
    message: "Use the Text component from @/components/ignite/Text with the tx prop.",
  },
]

export default defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: [
      "ios/**",
      "android/**",
      "modules/*/android/build/**",
      "node_modules/**",
      ".expo/**",
      "expo-env.d.ts",
      "src/uniwind-types.d.ts",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    plugins: {"prettier": pluginPrettier, "react-native": pluginReactNative},
    rules: {
      "prettier/prettier": "error",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "import/no-named-as-default-member": "off",
      "no-restricted-imports": [
        "error",
        {paths: restrictedImportPaths, patterns: [{group: ["../*"], message: "Use @/ path aliases."}]},
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "StyleSheet",
          property: "create",
          message: "Use className, or ThemedStyle with useAppTheme() for theme values, instead of StyleSheet.create.",
        },
      ],
      "react-native/no-raw-text": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", {argsIgnorePattern: "^_", varsIgnorePattern: "^_"}],
    },
  },
  {
    files: ["src/stores/navigation.ts"],
    rules: {"no-restricted-imports": "off"},
  },
  {
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx"],
    plugins: {i18next: pluginI18next},
    rules: {
      "i18next/no-literal-string": [
        "warn",
        {
          "mode": "jsx-only",
          "jsx-attributes": {
            include: ["text", "title", "label", "subtitle", "message", "placeholder", "accessibilityLabel"],
            exclude: [".*"],
          },
          "callees": {
            exclude: ["i18n(ext)?", "t", "translate", "require", "addEventListener", "removeEventListener"],
          },
        },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "jest.setup.js", "jest.config.js"],
    languageOptions: {globals: {jest: "readonly", describe: "readonly", it: "readonly", expect: "readonly"}},
  },
])
