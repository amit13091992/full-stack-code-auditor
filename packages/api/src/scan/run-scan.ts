import type { AnalyzerConfig, ScanEventListener, ScanResult } from "@code-analyzer/core";
import { AnalyzerClient } from "@code-analyzer/core";
import { projectModelDiscoverer } from "@code-analyzer/project-model";
import { graphProjectIndexer } from "@code-analyzer/graph";
import { registerBuiltinAnalyzers } from "@code-analyzer/analyzers";
import { InMemoryAnalyzerRegistry } from "./registry.js";

export interface RunScanOptions {
  readonly root: string;
  readonly signal: AbortSignal;
  readonly onEvent?: ScanEventListener;
}

/**
 * Mirrors `packages/cli/src/commands/scan.ts`'s wiring exactly (real discovery + the Phase 3
 * `graphProjectIndexer` + the built-in analyzer set) against an already-materialized temp workspace
 * instead of a git checkout. Sandbox flags are hardcoded here, never accepted from a request body —
 * no scanned code is ever executed (Section 31).
 */
export async function runScan(options: RunScanOptions): Promise<ScanResult> {
  const registry = new InMemoryAnalyzerRegistry();
  registerBuiltinAnalyzers(registry);

  const config: AnalyzerConfig = {
    root: options.root,
    profile: "minimal",
    ignore: { patterns: [], respectGitignore: true },
    incremental: { enabled: false },
    sandbox: { enabled: true, networkAccess: false },
  };

  const client = new AnalyzerClient({
    config,
    registry,
    strategies: {
      discoverer: projectModelDiscoverer,
      indexer: graphProjectIndexer,
    },
  });

  return client.scan({
    signal: options.signal,
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
  });
}
