import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Analyzer, AnalyzerConfig, AnalyzerContext, AnalyzerRegistry, Finding, FindingId } from "../../packages/core/src/index.js";
import { AnalyzerClient } from "../../packages/core/src/index.js";
import { projectModelDiscoverer } from "../../packages/project-model/src/index.js";
import { graphProjectIndexer } from "../../packages/graph/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/graph/taint-links");

class InMemoryRegistry implements AnalyzerRegistry {
  private readonly analyzers = new Map<string, Analyzer>();
  register(analyzer: Analyzer): void {
    this.analyzers.set(analyzer.id, analyzer);
  }
  get(id: string): Analyzer | undefined {
    return this.analyzers.get(id);
  }
  list(): readonly Analyzer[] {
    return [...this.analyzers.values()];
  }
  listByCategory(category: Analyzer["capabilities"]["category"]): readonly Analyzer[] {
    return this.list().filter((a) => a.capabilities.category === category);
  }
}

/**
 * A placeholder analyzer that only reads `context.graphs.taintGraph` and reports how many
 * `FLOWS_TO` edges it found - proving discover -> parse -> graph -> analyze works end-to-end for
 * Phase 5's wiring (docs/tasks/phase-5-taint-graph.md checklist step 8), the same way
 * `call-graph-end-to-end.test.ts` proves it for Phase 4's Call Graph. Deliberately NOT a
 * `security/*` rule: no CWE/OWASP metadata, no vulnerability judgment - that content is gated
 * behind Section 47's enhanced review path and is explicitly out of scope here.
 */
const taintGraphSummaryAnalyzer: Analyzer = {
  id: "quality/taint-graph-summary",
  name: "Taint Graph Summary",
  version: "0.0.0",
  capabilities: { category: "quality", requiresGraphs: ["taintGraph"] },
  supports: (context) => Boolean(context.graphs.taintGraph),
  async analyze(context: AnalyzerContext) {
    const graph = context.graphs.taintGraph!;
    const findings: Finding[] = [];
    const edges = graph.query({ edgeType: "FLOWS_TO" });

    findings.push({
      id: "taint-graph-summary-0" as FindingId,
      ruleId: "quality/taint-graph-summary",
      category: "quality",
      severity: "info",
      confidence: 1,
      status: "confirmed",
      title: `Taint Graph has ${edges.length} FLOWS_TO edges`,
      description: "Summarizes FLOWS_TO edge count across the project's Taint Graph.",
      locations: [],
      evidenceIds: [],
      correlatedFindingIds: [],
    });

    return { analyzerId: "quality/taint-graph-summary", findings, evidence: [], diagnostics: [], durationMs: 0 };
  },
};

function configFor(root: string): AnalyzerConfig {
  return {
    root,
    profile: "standard",
    ignore: { patterns: [], respectGitignore: true },
    incremental: { enabled: false },
    sandbox: { enabled: true, networkAccess: false },
  };
}

describe("Phase 5 end-to-end: real discovery -> real parsing -> real graph building -> real analyzer", () => {
  it("builds a real Taint Graph and a real analyzer reads context.graphs.taintGraph", async () => {
    const registry = new InMemoryRegistry();
    registry.register(taintGraphSummaryAnalyzer);

    const client = new AnalyzerClient({
      config: configFor(FIXTURES_ROOT),
      registry,
      strategies: {
        discoverer: projectModelDiscoverer,
        indexer: graphProjectIndexer,
      },
    });

    const result = await client.scan();

    expect(result.scan.status).toBe("completed");
    expect(result.findings).toHaveLength(1);
    const match = result.findings[0]?.title.match(/(\d+) FLOWS_TO edges/);
    expect(match).not.toBeNull();
    const total = Number(match![1]);
    // unsanitized-flow.ts and sanitized-flow.ts each contribute a same-function FLOWS_TO edge,
    // and unknown-edge-flow.ts contributes one through the "unknown" callback-reachability CALLS
    // edge - false-positive-safe-sink.ts and no-source-no-sink.ts contribute none.
    expect(total).toBeGreaterThan(0);
  });
});
