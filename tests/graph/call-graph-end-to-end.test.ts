import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Analyzer, AnalyzerConfig, AnalyzerContext, AnalyzerRegistry, Finding, FindingId } from "../../packages/core/src/index.js";
import { AnalyzerClient } from "../../packages/core/src/index.js";
import { projectModelDiscoverer } from "../../packages/project-model/src/index.js";
import { graphProjectIndexer } from "../../packages/graph/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/graph/call-links");

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

/** A real analyzer reading the real Call Graph — proves discover -> parse -> graph -> analyze
 * works end-to-end for Phase 4, the same way end-to-end.test.ts proves it for the Module Graph. */
const callResolutionAnalyzer: Analyzer = {
  id: "quality/call-resolution-summary",
  name: "Call Resolution Summary",
  version: "0.0.0",
  capabilities: { category: "quality", requiresGraphs: ["callGraph"] },
  supports: (context) => Boolean(context.graphs.callGraph),
  async analyze(context: AnalyzerContext) {
    const graph = context.graphs.callGraph!;
    const findings: Finding[] = [];
    const edges = graph.query({ edgeType: "CALLS" });
    const uncertainCount = edges.filter((e) => e.certainty === "dynamic" || e.certainty === "unknown").length;

    findings.push({
      id: "call-resolution-0" as FindingId,
      ruleId: "quality/call-resolution-summary",
      category: "quality",
      severity: "info",
      confidence: 1,
      status: "confirmed",
      title: `Call Graph has ${edges.length} CALLS edges, ${uncertainCount} not statically resolved`,
      description: "Summarizes CALLS edge certainty across the project's Call Graph.",
      locations: [],
      evidenceIds: [],
      correlatedFindingIds: [],
    });

    return { analyzerId: "quality/call-resolution-summary", findings, evidence: [], diagnostics: [], durationMs: 0 };
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

describe("Phase 4 end-to-end: real discovery -> real parsing -> real graph building -> real analyzer", () => {
  it("builds a real Call Graph and a real analyzer reads context.graphs.callGraph", async () => {
    const registry = new InMemoryRegistry();
    registry.register(callResolutionAnalyzer);

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
    // Direct (direct.ts), resolved (helper.ts import), dynamic (dynamic-dispatch.ts), and
    // unknown (callback-argument.ts, inheritance-child.ts) edges should all be present across
    // this fixture set -> at least some edges resolved statically, and at least some not.
    expect(result.findings[0]?.title).toMatch(/CALLS edges/);
    const match = result.findings[0]?.title.match(/(\d+) CALLS edges, (\d+) not statically resolved/);
    expect(match).not.toBeNull();
    const total = Number(match![1]);
    const uncertain = Number(match![2]);
    expect(total).toBeGreaterThan(0);
    expect(uncertain).toBeGreaterThan(0);
    expect(uncertain).toBeLessThan(total);
  });
});
