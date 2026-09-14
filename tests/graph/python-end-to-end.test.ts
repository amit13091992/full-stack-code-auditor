import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Analyzer, AnalyzerConfig, AnalyzerContext, AnalyzerRegistry, Finding, FindingId } from "../../packages/core/src/index.js";
import { AnalyzerClient } from "../../packages/core/src/index.js";
import { projectModelDiscoverer } from "../../packages/project-model/src/index.js";
import { graphProjectIndexer } from "../../packages/graph/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/project-model/python-flask");

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

/** A real analyzer reading real Python-parsed output — proves discover -> parse(Python) -> graph -> analyze works end-to-end (ADR-0009). */
const pythonClassAnalyzer: Analyzer = {
  id: "quality/python-class-count",
  name: "Python Class Count",
  version: "0.0.0",
  capabilities: { category: "quality" },
  supports: () => true,
  async analyze(context: AnalyzerContext) {
    const findings: Finding[] = context.project.classes.map((cls, index) => ({
      id: `python-class-${index}` as FindingId,
      ruleId: "quality/python-class-count",
      category: "quality",
      severity: "info",
      confidence: 1,
      status: "confirmed",
      title: `Python class: ${cls.name}`,
      description: `${cls.name} declared in ${cls.moduleId}, ${cls.methods.length} method(s).`,
      locations: [cls.location],
      evidenceIds: [],
      correlatedFindingIds: [],
    }));
    return { analyzerId: "quality/python-class-count", findings, evidence: [], diagnostics: [], durationMs: 0 };
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

describe("Python end-to-end (ADR-0009): real discovery -> real Tree-sitter parsing -> real Symbol Graph -> real analyzer", () => {
  it("discovers a Python/Flask fixture, parses app.py with Tree-sitter, and a real analyzer reads context.project.classes", async () => {
    const registry = new InMemoryRegistry();
    registry.register(pythonClassAnalyzer);

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
    expect(result.findings[0]?.title).toBe("Python class: RequestHandler");
    expect(result.findings[0]?.description).toContain("2 method(s)"); // __init__ + handle
  });

  it("builds a real Symbol Graph (DECLARES) over Python output via the Module/Symbol Graph builders, language-agnostically", async () => {
    const registry = new InMemoryRegistry();
    const symbolGraphAnalyzer: Analyzer = {
      id: "quality/python-symbol-graph-check",
      name: "Python Symbol Graph Check",
      version: "0.0.0",
      capabilities: { category: "quality", requiresGraphs: ["symbolGraph"] },
      supports: (context) => Boolean(context.graphs.symbolGraph),
      async analyze(context: AnalyzerContext) {
        const graph = context.graphs.symbolGraph!;
        const declareEdges = graph.query({ edgeType: "DECLARES" });
        const finding: Finding = {
          id: "symbol-graph-check" as FindingId,
          ruleId: "quality/python-symbol-graph-check",
          category: "quality",
          severity: "info",
          confidence: 1,
          status: "confirmed",
          title: `${declareEdges.length} DECLARES edges`,
          description: "count of DECLARES edges in the Symbol Graph over Python-parsed output",
          locations: [],
          evidenceIds: [],
          correlatedFindingIds: [],
        };
        return { analyzerId: "quality/python-symbol-graph-check", findings: [finding], evidence: [], diagnostics: [], durationMs: 0 };
      },
    };
    registry.register(symbolGraphAnalyzer);

    const client = new AnalyzerClient({
      config: configFor(FIXTURES_ROOT),
      registry,
      strategies: { discoverer: projectModelDiscoverer, indexer: graphProjectIndexer },
    });

    const result = await client.scan();
    // app.py declares: create_app (function), RequestHandler (class) -> at least 2 DECLARES edges
    // from the module node, proving the Symbol Graph builder works over Python-parsed entities
    // without any Python-specific code in packages/graph (ADR-0009).
    const count = Number(result.findings[0]?.title.split(" ")[0]);
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
