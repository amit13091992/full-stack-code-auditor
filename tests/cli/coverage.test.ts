import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Analyzer, AnalyzerCategory, AnalyzerContext, AnalyzerRegistry, CoverageModel } from "../../packages/core/src/index.js";
import { AnalyzerClient } from "../../packages/core/src/index.js";
import { projectModelDiscoverer } from "../../packages/project-model/src/index.js";
import { graphProjectIndexer } from "../../packages/graph/src/index.js";
import { parseLcov } from "../../packages/integrations/src/index.js";
import { parseArgs } from "../../packages/cli/src/args.js";
import { runScanCommand } from "../../packages/cli/src/commands/scan.js";
import { configFor } from "../analyzers/test-context.js";
import { promises as fs } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/coverage");

class RecordingRegistry implements AnalyzerRegistry {
  seenCoverage: CoverageModel | undefined;
  private readonly analyzers = new Map<string, Analyzer>();

  constructor() {
    const self = this;
    this.analyzers.set("test/coverage-recorder", {
      id: "test/coverage-recorder",
      capabilities: { category: "quality" as AnalyzerCategory, requiresGraphs: [] },
      supports: () => true,
      analyze: async (context: AnalyzerContext) => {
        self.seenCoverage = context.coverage;
        return { findings: [], evidence: [], diagnostics: [] };
      },
    });
  }

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

describe("AnalyzerContext.coverage end-to-end", () => {
  it("populates context.coverage through AnalyzerClient.scan() when a CoverageModel is supplied via ScanOptions", async () => {
    const root = path.join(FIXTURES_ROOT, "lcov/project");
    const config = configFor(root);
    const project = await projectModelDiscoverer.discover(root, config, {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    const content = await fs.readFile(path.join(FIXTURES_ROOT, "lcov/report.lcov"), "utf-8");
    const { coverage } = parseLcov(content, project.files, "2026-09-19T00:00:00.000Z");

    const registry = new RecordingRegistry();
    const client = new AnalyzerClient({
      config,
      registry,
      strategies: { discoverer: projectModelDiscoverer, indexer: graphProjectIndexer },
    });

    await client.scan({ coverage });

    expect(registry.seenCoverage).toBeDefined();
    expect(registry.seenCoverage?.files.some((f) => f.fileId.endsWith("covered.js"))).toBe(true);
  });

  it("populates coverage through the real CLI --coverage flag and surfaces the unmapped-path diagnostic", async () => {
    const root = path.join(FIXTURES_ROOT, "lcov/project");
    const reportPath = path.join(FIXTURES_ROOT, "lcov/report.lcov");

    const outcome = await runScanCommand(parseArgs(["scan", root, "--format", "json", "--coverage", reportPath]));

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.diagnostics.some((d) => d.code === "COVERAGE_UNMAPPED_FILE")).toBe(true);
  });
});
