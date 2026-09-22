import { promises as fs } from "node:fs";
import path from "node:path";
import type { AnalyzerConfig, CoverageModel, Diagnostic, ScanProfile, ScanResult, SourceFile } from "@code-analyzer/core";
import { AnalyzerClient, noopLogger } from "@code-analyzer/core";
import { projectModelDiscoverer } from "@code-analyzer/project-model";
import { graphProjectIndexer } from "@code-analyzer/graph";
import { registerBuiltinAnalyzers } from "@code-analyzer/analyzers";
import { parseCoveragePy, parseIstanbulJson, parseLcov } from "@code-analyzer/integrations";
import type { ParsedArgs } from "../args.js";
import { getExporter, type ExportFormat } from "../exporters/index.js";
import { renderHtmlReport } from "../exporters/html.js";
import { InMemoryAnalyzerRegistry } from "../registry.js";

const VALID_FORMATS: readonly ExportFormat[] = ["json", "sarif", "html"];
const VALID_PROFILES: readonly ScanProfile[] = ["minimal", "standard", "security", "full", "enterprise"];

export interface ScanCommandResult {
  readonly exitCode: number;
  readonly result?: ScanResult;
  readonly report?: string;
  readonly errorMessage?: string;
}

function detectCoverageFormat(reportPath: string, content: string): "lcov" | "istanbul" | "coverage-py" {
  if (!reportPath.endsWith(".json")) return "lcov";
  const parsed: unknown = JSON.parse(content);
  if (parsed !== null && typeof parsed === "object" && "files" in parsed) return "coverage-py";
  return "istanbul";
}

/**
 * Reads and parses a coverage report already produced on disk (Section 31 — never runs the user's
 * test suite itself). Mapping report paths to `FileId` needs the real file list, which only exists
 * after discovery, so this runs discovery once up front purely for that mapping; `client.scan()`
 * still performs its own discovery for the actual scan per the unchanged `ScanEngine` lifecycle.
 */
async function loadCoverage(
  coveragePath: string,
  config: AnalyzerConfig,
): Promise<{ coverage: CoverageModel; diagnostics: readonly Diagnostic[] }> {
  const project = await projectModelDiscoverer.discover(config.root, config, noopLogger);
  const files: readonly SourceFile[] = project.files;
  const content = await fs.readFile(path.resolve(coveragePath), "utf-8");
  const collectedAt = new Date().toISOString();

  const format = detectCoverageFormat(coveragePath, content);
  if (format === "coverage-py") return parseCoveragePy(content, files, collectedAt);
  if (format === "istanbul") return parseIstanbulJson(content, files, collectedAt);
  return parseLcov(content, files, collectedAt);
}

function buildConfig(root: string, profile: ScanProfile): AnalyzerConfig {
  return {
    root,
    profile,
    ignore: { patterns: [], respectGitignore: true },
    incremental: { enabled: false },
    sandbox: { enabled: true, networkAccess: false },
  };
}

/**
 * `codegraph-scan scan <root> [--profile <profile>] [--format json|sarif|html] [--out <path>]
 * [--coverage <path>]` — `--coverage` is an explicit opt-in that only reads a report already on
 * disk (LCOV/Istanbul/coverage.py JSON, auto-detected); it never runs the user's test suite
 * (Section 31, ADR-0010).
 * (docs/tasks/cli-and-reporting.md). Wires real Phase 1 discovery + `graphProjectIndexer`
 * (Phase 3, the superset indexer — it composes Phase 2's real parsing and then builds the Module/
 * Symbol Graph over the result, so `scan` gets both without wiring two separate indexers) +
 * `@code-analyzer/analyzers`' built-in rules (`docs/tasks/first-graph-analyzers.md`), registered
 * against this command's own `InMemoryAnalyzerRegistry` — not wired directly into the package, per
 * the analyzer-development skill's registry-based integration pattern.
 */
export async function runScanCommand(args: ParsedArgs): Promise<ScanCommandResult> {
  const root = args.positional[0];
  if (!root) {
    return {
      exitCode: 1,
      errorMessage: "Usage: codegraph-scan scan <root> [--profile <profile>] [--format json|sarif|html] [--out <path>] [--coverage <path>]",
    };
  }

  const format = (args.flags.format ?? "json") as ExportFormat;
  if (!VALID_FORMATS.includes(format)) {
    return { exitCode: 1, errorMessage: `Unknown --format "${format}". Expected one of: ${VALID_FORMATS.join(", ")}` };
  }

  const profile = (args.flags.profile ?? "standard") as ScanProfile;
  if (!VALID_PROFILES.includes(profile)) {
    return { exitCode: 1, errorMessage: `Unknown --profile "${profile}". Expected one of: ${VALID_PROFILES.join(", ")}` };
  }

  const absoluteRoot = path.resolve(root);
  try {
    await fs.access(absoluteRoot);
  } catch {
    return { exitCode: 1, errorMessage: `Repository root not found: ${absoluteRoot}` };
  }

  const registry = new InMemoryAnalyzerRegistry();
  registerBuiltinAnalyzers(registry);

  const config = buildConfig(absoluteRoot, profile);
  const client = new AnalyzerClient({
    config,
    registry,
    strategies: {
      discoverer: projectModelDiscoverer,
      indexer: graphProjectIndexer,
    },
  });

  let coverage: CoverageModel | undefined;
  let coverageDiagnostics: readonly Diagnostic[] = [];
  const coveragePath = args.flags.coverage;
  if (coveragePath) {
    try {
      const loaded = await loadCoverage(coveragePath, config);
      coverage = loaded.coverage;
      coverageDiagnostics = loaded.diagnostics;
    } catch (error) {
      return { exitCode: 1, errorMessage: `Failed to read --coverage report "${coveragePath}": ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  let result: ScanResult;
  try {
    result = await client.scan(coverage ? { coverage } : undefined);
  } catch (error) {
    return { exitCode: 1, errorMessage: error instanceof Error ? error.message : String(error) };
  }

  if (coverageDiagnostics.length > 0) {
    result = { ...result, diagnostics: [...result.diagnostics, ...coverageDiagnostics] };
  }

  // `html` gets the live repo root so the report can show real source-code snippets per finding
  // (the `export` command re-formatting a saved ScanResult JSON has no root and gets none — expected).
  const report = format === "html" ? renderHtmlReport(result, { rootPath: absoluteRoot }) : getExporter(format).export(result);

  const outPath = args.flags.out;
  if (outPath) {
    await fs.writeFile(path.resolve(outPath), report, "utf-8");
  }

  return { exitCode: 0, result, report };
}
