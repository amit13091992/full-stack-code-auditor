import { promises as fs } from "node:fs";
import path from "node:path";
import type { AnalyzerConfig, ScanProfile, ScanResult } from "@code-analyzer/core";
import { AnalyzerClient } from "@code-analyzer/core";
import { projectModelDiscoverer } from "@code-analyzer/project-model";
import { graphProjectIndexer } from "@code-analyzer/graph";
import type { ParsedArgs } from "../args.js";
import { getExporter, type ExportFormat } from "../exporters/index.js";
import { InMemoryAnalyzerRegistry } from "../registry.js";

const VALID_FORMATS: readonly ExportFormat[] = ["json", "sarif", "html"];
const VALID_PROFILES: readonly ScanProfile[] = ["minimal", "standard", "security", "full", "enterprise"];

export interface ScanCommandResult {
  readonly exitCode: number;
  readonly result?: ScanResult;
  readonly report?: string;
  readonly errorMessage?: string;
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
 * `code-analyzer scan <root> [--profile <profile>] [--format json|sarif|html] [--out <path>]`
 * (docs/tasks/cli-and-reporting.md). Wires real Phase 1 discovery + `graphProjectIndexer`
 * (Phase 3, the superset indexer — it composes Phase 2's real parsing and then builds the Module/
 * Symbol Graph over the result, so `scan` gets both without wiring two separate indexers) +
 * whatever analyzers are registered (none today — `@code-analyzer/analyzers` is still an empty
 * stub, so `findings` is legitimately empty; `diagnostics` is no longer, per ADR-0008).
 */
export async function runScanCommand(args: ParsedArgs): Promise<ScanCommandResult> {
  const root = args.positional[0];
  if (!root) {
    return { exitCode: 1, errorMessage: "Usage: code-analyzer scan <root> [--profile <profile>] [--format json|sarif|html] [--out <path>]" };
  }

  const format = (args.flags.format ?? "json") as ExportFormat;
  if (!VALID_FORMATS.includes(format)) {
    return { exitCode: 1, errorMessage: `Unknown --format "${format}". Expected one of: ${VALID_FORMATS.join(", ")}` };
  }

  const profile = (args.flags.profile ?? "minimal") as ScanProfile;
  if (!VALID_PROFILES.includes(profile)) {
    return { exitCode: 1, errorMessage: `Unknown --profile "${profile}". Expected one of: ${VALID_PROFILES.join(", ")}` };
  }

  const absoluteRoot = path.resolve(root);
  try {
    await fs.access(absoluteRoot);
  } catch {
    return { exitCode: 1, errorMessage: `Repository root not found: ${absoluteRoot}` };
  }

  const client = new AnalyzerClient({
    config: buildConfig(absoluteRoot, profile),
    registry: new InMemoryAnalyzerRegistry(),
    strategies: {
      discoverer: projectModelDiscoverer,
      indexer: graphProjectIndexer,
    },
  });

  let result: ScanResult;
  try {
    result = await client.scan();
  } catch (error) {
    return { exitCode: 1, errorMessage: error instanceof Error ? error.message : String(error) };
  }

  const report = getExporter(format).export(result);

  const outPath = args.flags.out;
  if (outPath) {
    await fs.writeFile(path.resolve(outPath), report, "utf-8");
  }

  return { exitCode: 0, result, report };
}
