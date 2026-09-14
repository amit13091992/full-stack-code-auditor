import { describe, expect, it } from "vitest";
import type {
  Analyzer,
  AnalyzerConfig,
  AnalyzerContext,
  AnalyzerRegistry,
  Finding,
  FindingId,
  ProjectId,
  ProjectModel,
} from "../../packages/core/src/index.js";
import { AnalyzerClient } from "../../packages/core/src/index.js";

function emptyProject(): ProjectModel {
  return {
    id: "test-project" as ProjectId,
    repository: {
      metadata: { id: "repo-1" as never, root: "/tmp/fixture", vcs: "none", isMonorepo: false },
      packages: [],
    },
    frameworks: [],
    files: [],
    modules: [],
    symbols: [],
    functions: [],
    classes: [],
    dependencies: [],
    endpoints: [],
    databaseEntities: [],
    services: [],
    securityBoundaries: [],
  };
}

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

const fakeFinding: Finding = {
  id: "finding-1" as FindingId,
  ruleId: "test/always-fires",
  category: "quality",
  severity: "info",
  confidence: 1,
  status: "detected",
  title: "Fixture finding",
  description: "Emitted unconditionally by the fixture analyzer.",
  locations: [],
  evidenceIds: [],
  correlatedFindingIds: [],
};

const fixtureAnalyzer: Analyzer = {
  id: "test/always-fires",
  name: "Always Fires",
  version: "0.0.0",
  capabilities: { category: "quality" },
  supports(): boolean {
    return true;
  },
  async analyze(_context: AnalyzerContext) {
    return {
      analyzerId: "test/always-fires",
      findings: [fakeFinding],
      evidence: [],
      diagnostics: [],
      durationMs: 0,
    };
  },
};

function testConfig(): AnalyzerConfig {
  return {
    root: "/tmp/fixture",
    profile: "minimal",
    ignore: { patterns: [], respectGitignore: true },
    incremental: { enabled: false },
    sandbox: { enabled: true, networkAccess: false },
  };
}

describe("AnalyzerClient / ScanEngine lifecycle", () => {
  it("runs discover -> index -> analyze -> correlate -> finalize and returns a ScanResult", async () => {
    const registry = new InMemoryRegistry();
    registry.register(fixtureAnalyzer);

    const client = new AnalyzerClient({
      config: testConfig(),
      registry,
      strategies: {
        discoverer: { discover: async () => emptyProject() },
        indexer: { index: async (project) => ({ project, graphs: {} }) },
      },
    });

    const result = await client.scan();

    expect(result.schemaVersion).toBe("0.1.0");
    expect(result.scan.status).toBe("completed");
    expect(result.scan.analyzersRun).toEqual(["test/always-fires"]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.ruleId).toBe("test/always-fires");
    expect(result.summary.totalFindings).toBe(1);
    expect(result.summary.findingsByCategory["quality"]).toBe(1);
  });

  it("skips analyzers whose supports() returns false", async () => {
    const registry = new InMemoryRegistry();
    registry.register({
      ...fixtureAnalyzer,
      id: "test/never-fires",
      supports: () => false,
    });

    const client = new AnalyzerClient({
      config: testConfig(),
      registry,
      strategies: {
        discoverer: { discover: async () => emptyProject() },
        indexer: { index: async (project) => ({ project, graphs: {} }) },
      },
    });

    const result = await client.scan();
    expect(result.findings).toHaveLength(0);
    expect(result.scan.analyzersRun).toEqual([]);
  });

  it("applies a correlator and risk calculator when provided", async () => {
    const registry = new InMemoryRegistry();
    registry.register(fixtureAnalyzer);

    const client = new AnalyzerClient({
      config: testConfig(),
      registry,
      strategies: {
        discoverer: { discover: async () => emptyProject() },
        indexer: { index: async (project) => ({ project, graphs: {} }) },
        correlator: { correlate: async (findings) => findings },
        riskCalculator: {
          score: async (findings) => findings.map((f) => ({ ...f, risk: { severity: f.severity, confidence: f.confidence } })),
        },
      },
    });

    const result = await client.scan();
    expect(result.findings[0]?.risk?.severity).toBe("info");
  });
});
