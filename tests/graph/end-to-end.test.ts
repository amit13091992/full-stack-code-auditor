import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Analyzer, AnalyzerConfig, AnalyzerContext, AnalyzerRegistry, Finding, FindingId } from "../../packages/core/src/index.js";
import { AnalyzerClient } from "../../packages/core/src/index.js";
import { projectModelDiscoverer } from "../../packages/project-model/src/index.js";
import { graphProjectIndexer } from "../../packages/graph/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/graph/module-links");

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

/** A real analyzer reading the real Module Graph — proves discover -> parse -> graph -> analyze works end-to-end. */
const unresolvedImportAnalyzer: Analyzer = {
  id: "quality/module-import-fanout",
  name: "Module Import Fan-out",
  version: "0.0.0",
  capabilities: { category: "quality", requiresGraphs: ["moduleGraph"] },
  supports: (context) => Boolean(context.graphs.moduleGraph),
  async analyze(context: AnalyzerContext) {
    const graph = context.graphs.moduleGraph!;
    const findings: Finding[] = [];
    let index = 0;
    for (const module of context.project.modules) {
      const importCount = graph.query({ edgeType: "IMPORTS", fromNodeId: `module:${module.id}` as never }).length;
      if (importCount > 1) {
        findings.push({
          id: `fanout-${index++}` as FindingId,
          ruleId: "quality/module-import-fanout",
          category: "quality",
          severity: "info",
          confidence: 1,
          status: "confirmed",
          title: `${module.id} imports ${importCount} project-internal modules`,
          description: `${module.id} has ${importCount} resolved IMPORTS edges in the module graph.`,
          locations: [],
          evidenceIds: [],
          correlatedFindingIds: [],
        });
      }
    }
    return { analyzerId: "quality/module-import-fanout", findings, evidence: [], diagnostics: [], durationMs: 0 };
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

describe("Phase 3 end-to-end: real discovery -> real parsing -> real graph building -> real analyzer", () => {
  it("builds a real Module Graph and Symbol Graph and a real analyzer reads context.graphs.moduleGraph", async () => {
    const registry = new InMemoryRegistry();
    registry.register(unresolvedImportAnalyzer);

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
    // main.ts imports both math.ts and utils/index.ts -> fan-out of 2, so it should be flagged.
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toContain("main.ts");
    expect(result.findings[0]?.description).toContain("2 resolved IMPORTS");
  });
});
