import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Analyzer, AnalyzerConfig, AnalyzerContext, AnalyzerRegistry, Finding, FindingId } from "../../packages/core/src/index.js";
import { AnalyzerClient } from "../../packages/core/src/index.js";
import { projectModelDiscoverer } from "../../packages/project-model/src/index.js";
import { parserProjectIndexer } from "../../packages/parser/src/index.js";
import { noopLogger } from "../../packages/core/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/parser/basic-constructs");

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

/** A real analyzer reading real Phase 2 output — proves discover -> index(parse) -> analyze works end-to-end. */
const exportedFunctionCountAnalyzer: Analyzer = {
  id: "quality/exported-function-count",
  name: "Exported Function Count",
  version: "0.0.0",
  capabilities: { category: "quality" },
  supports: () => true,
  async analyze(context: AnalyzerContext) {
    const exportedFunctions = context.project.functions.filter((f) => f.isExported);
    const findings: Finding[] = exportedFunctions.map((fn, index) => ({
      id: `exported-fn-${index}` as FindingId,
      ruleId: "quality/exported-function-count",
      category: "quality",
      severity: "info",
      confidence: 1,
      status: "confirmed",
      title: `Exported function: ${fn.name}`,
      description: `${fn.name} (${fn.flavor}) is exported from ${fn.moduleId}.`,
      locations: [fn.location],
      evidenceIds: [],
      correlatedFindingIds: [],
    }));
    return { analyzerId: "quality/exported-function-count", findings, evidence: [], diagnostics: [], durationMs: 0 };
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

describe("Phase 2 end-to-end: real discovery -> real parsing -> real analyzer through AnalyzerClient", () => {
  it("parses the fixtures/parser/basic-constructs repo and a real analyzer sees real Symbol/FunctionEntity/ClassEntity data", async () => {
    const registry = new InMemoryRegistry();
    registry.register(exportedFunctionCountAnalyzer);

    const client = new AnalyzerClient({
      config: configFor(FIXTURES_ROOT),
      registry,
      strategies: {
        discoverer: projectModelDiscoverer,
        indexer: parserProjectIndexer,
      },
    });

    const result = await client.scan();

    expect(result.scan.status).toBe("completed");
    // add/multiply/loadNamespace (functions.ts + imports-exports.ts) are exported; fetchThing is not.
    const titles = result.findings.map((f) => f.title).sort();
    expect(titles).toContain("Exported function: add");
    expect(titles).toContain("Exported function: multiply");
    expect(titles.some((t) => t.includes("fetchThing"))).toBe(false);

    expect(result.summary.totalFindings).toBeGreaterThan(0);
  });

  it("populates ProjectModel.modules/symbols/functions/classes and tolerates the malformed.ts fixture without aborting", async () => {
    const registry = new InMemoryRegistry();

    const client = new AnalyzerClient({
      config: configFor(FIXTURES_ROOT),
      registry,
      strategies: {
        discoverer: projectModelDiscoverer,
        indexer: parserProjectIndexer,
      },
    });

    const result = await client.scan();

    expect(result.scan.status).toBe("completed");
    // Every non-generated/vendored/asset .ts/.js file in the fixture got a Module, including
    // malformed.ts (best-effort) — the scan completes rather than aborting on its syntax error.
    expect(result.summary.filesAnalyzed).toBeGreaterThan(0);
  });

  it("skips non-JS/TS files (data.json) per its language filter and leaves graphs empty", async () => {
    const project = await projectModelDiscoverer.discover(FIXTURES_ROOT, configFor(FIXTURES_ROOT), noopLogger);

    // Sanity: the fixture root does contain a non-JS/TS file, or this test proves nothing.
    const jsonFile = project.files.find((f) => f.path.endsWith("data.json"));
    expect(jsonFile).toBeDefined();
    expect(jsonFile?.language).toBe("json");

    const { project: indexed, graphs } = await parserProjectIndexer.index(project, noopLogger);

    // data.json's language ("json") isn't in PARSEABLE_LANGUAGES — no Module should be produced
    // for it (project-indexer.ts's `!PARSEABLE_LANGUAGES.has(file.language)` skip branch).
    const jsonModule = indexed.modules.find((m) => m.fileId === jsonFile?.id);
    expect(jsonModule).toBeUndefined();

    // .ts/.js files still get parsed and produce modules alongside the skipped file.
    const tsModule = indexed.modules.find((m) => m.id === "functions.ts");
    expect(tsModule).toBeDefined();

    // Phase 2 is parsing only — module/symbol/call/taint graphs are Phase 3-5, so `graphs` must
    // stay the empty object documented in project-indexer.ts, not a partially-populated one.
    expect(graphs).toEqual({});
  });
});
