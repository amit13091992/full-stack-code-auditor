import path from "node:path";
import type { LanguageId, SourceClassification } from "@code-analyzer/core";

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, LanguageId>> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".json": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".sql": "sql",
  ".py": "python",
  ".pyi": "python",
};

const DOCUMENTATION_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);
const ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".webp",
]);

const TEST_PATH_SEGMENTS = new Set(["test", "tests", "__tests__", "__mocks__"]);
const TEST_NAME_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/i;
// Python's own conventions: pytest/unittest discover test_*.py and *_test.py by default.
const PYTHON_TEST_NAME_PATTERN = /^(test_.+|.+_test)\.pyi?$/i;

const GENERATED_PATH_SEGMENTS = new Set(["dist", "build", ".next", "coverage", "generated", "out"]);
const GENERATED_NAME_PATTERN = /\.(generated|gen)\.[cm]?[jt]sx?$/i;

const VENDORED_PATH_SEGMENTS = new Set(["vendor", "vendored", "third_party", "third-party"]);

const CONFIG_FILENAMES = new Set([
  "package.json",
  "tsconfig.json",
  ".eslintrc.js",
  ".eslintrc.json",
  ".eslintrc.cjs",
  ".prettierrc",
  "jest.config.js",
  "jest.config.ts",
  "vitest.config.ts",
  "next.config.js",
  "next.config.mjs",
  "nest-cli.json",
  ".babelrc",
  "babel.config.js",
  "metro.config.js",
  ".env.example",
  "pyproject.toml",
  "requirements.txt",
  "setup.cfg",
  "pipfile",
]);
const CONFIG_NAME_PATTERN = /^(tsconfig|jest\.config|vitest\.config|.*\.config)\.[cm]?[jt]sx?$/i;

const INFRASTRUCTURE_FILENAMES = new Set(["dockerfile", "docker-compose.yml", "docker-compose.yaml", "nginx.conf"]);
const INFRASTRUCTURE_PATH_SEGMENTS = new Set([".github", "k8s", "helm", "terraform"]);

/** Detects the LanguageId for a file by extension, or its exact filename for extensionless files (e.g. Dockerfile). */
export function classifyLanguage(relativePath: string): LanguageId {
  const base = path.basename(relativePath).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  const ext = path.extname(relativePath).toLowerCase();
  return LANGUAGE_BY_EXTENSION[ext] ?? "unknown";
}

/**
 * Classifies a file's role in the repository (Section 1's requirement to distinguish source from
 * test/config/infrastructure/generated code). Checked in a fixed priority order so a generated
 * test fixture (rare but possible) is still reported as generated first.
 */
export function classifySource(relativePath: string): SourceClassification {
  const segments = relativePath.split("/");
  const base = segments[segments.length - 1]?.toLowerCase() ?? "";
  const ext = path.extname(base);

  if (segments.some((segment) => GENERATED_PATH_SEGMENTS.has(segment.toLowerCase())) || GENERATED_NAME_PATTERN.test(base)) {
    return "generated";
  }
  if (segments.some((segment) => VENDORED_PATH_SEGMENTS.has(segment.toLowerCase()))) {
    return "vendored";
  }
  if (segments.some((segment) => INFRASTRUCTURE_PATH_SEGMENTS.has(segment.toLowerCase())) || INFRASTRUCTURE_FILENAMES.has(base)) {
    return "infrastructure";
  }
  if (
    segments.some((segment) => TEST_PATH_SEGMENTS.has(segment.toLowerCase())) ||
    TEST_NAME_PATTERN.test(base) ||
    PYTHON_TEST_NAME_PATTERN.test(base)
  ) {
    return "test";
  }
  // An exact config-filename match (e.g. "requirements.txt") wins over a generic
  // extension-based documentation guess (".txt" -> documentation) — a specific, known filename
  // is stronger evidence than its extension alone.
  if (CONFIG_FILENAMES.has(base)) {
    return "config";
  }
  if (DOCUMENTATION_EXTENSIONS.has(ext) || base === "license" || base.startsWith("license.")) {
    return "documentation";
  }
  if (ASSET_EXTENSIONS.has(ext)) {
    return "asset";
  }
  if (CONFIG_FILENAMES.has(base) || CONFIG_NAME_PATTERN.test(base) || ext === ".yml" || ext === ".yaml") {
    return "config";
  }

  const language = classifyLanguage(relativePath);
  if (language === "javascript" || language === "typescript" || language === "python" || language === "sql") return "source";
  if (language === "dockerfile") return "infrastructure";
  return "unknown";
}
