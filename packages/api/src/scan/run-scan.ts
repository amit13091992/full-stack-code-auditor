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
    // "full" (not "minimal"): the API takes no profile from the request today, and this package's
    // stated intent is running the same built-in analyzer set the CLI's default invocation runs —
    // "minimal" would now only run the architecture category since profile->category filtering
    // landed (ADR-0013), silently dropping quality/secrets findings this package's own tests
    // (tests/api/scan-route.test.ts) already assert on.
    profile: "full",
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
