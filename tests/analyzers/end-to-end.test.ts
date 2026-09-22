import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Analyzer, AnalyzerRegistry, AnalyzerCategory } from "../../packages/core/src/index.js";
import { AnalyzerClient } from "../../packages/core/src/index.js";
import { projectModelDiscoverer } from "../../packages/project-model/src/index.js";
import { graphProjectIndexer } from "../../packages/graph/src/index.js";
import { registerBuiltinAnalyzers } from "../../packages/analyzers/src/index.js";
import { configFor } from "./test-context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  listByCategory(category: AnalyzerCategory): readonly Analyzer[] {
    return this.list().filter((a) => a.capabilities.category === category);
  }
}

describe("first-graph-analyzers end-to-end: real discovery -> parse -> graph -> all three analyzers via AnalyzerClient", () => {
  it("runs circular-import, unresolved-import, and unused-export together through a real AnalyzerRegistry", async () => {
    const registry = new InMemoryRegistry();
    registerBuiltinAnalyzers(registry);
    expect(registry.list()).toHaveLength(9);

    const root = path.resolve(__dirname, "../../fixtures/architecture/circular-import/positive");
    const client = new AnalyzerClient({
      config: configFor(root),
      registry,
      strategies: {
        discoverer: projectModelDiscoverer,
        indexer: graphProjectIndexer,
      },
    });

    const result = await client.scan();

    expect(result.scan.status).toBe("completed");
    const circular = result.findings.filter((f) => f.ruleId === "architecture/circular-import");
    expect(circular).toHaveLength(1);
    expect(circular[0]?.status).toBe("detected");

    // a.ts/b.ts import each other -> neither has zero incoming edges -> no unused-export findings here.
    const unused = result.findings.filter((f) => f.ruleId === "quality/unused-export");
    expect(unused).toHaveLength(0);
  });

  it("flags the broken import and the module with zero incoming edges on their own fixtures", async () => {
    const registry = new InMemoryRegistry();
    registerBuiltinAnalyzers(registry);

    const unresolvedRoot = path.resolve(__dirname, "../../fixtures/architecture/unresolved-import/positive");
    const unresolvedClient = new AnalyzerClient({
      config: configFor(unresolvedRoot),
      registry,
      strategies: { discoverer: projectModelDiscoverer, indexer: graphProjectIndexer },
    });
    const unresolvedResult = await unresolvedClient.scan();
    expect(unresolvedResult.findings.filter((f) => f.ruleId === "architecture/unresolved-import")).toHaveLength(1);

    const unusedRoot = path.resolve(__dirname, "../../fixtures/quality/unused-export/positive");
    const unusedClient = new AnalyzerClient({
      config: configFor(unusedRoot),
      registry,
      strategies: { discoverer: projectModelDiscoverer, indexer: graphProjectIndexer },
    });
    const unusedResult = await unusedClient.scan();
    expect(unusedResult.findings.filter((f) => f.ruleId === "quality/unused-export")).toHaveLength(1);
  });
});
