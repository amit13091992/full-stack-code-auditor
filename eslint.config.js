// @ts-check
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    // fixtures/ are intentionally-shaped input repositories (malformed syntax, unused bindings,
    // etc. by design — Section 30) for parser/discovery tests, not project source — never lint them.
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.tsbuildinfo", "fixtures/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "no-unused-vars": "off",
    },
  },
];
