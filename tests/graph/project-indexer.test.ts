import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AnalyzerConfig, Logger } from "../../packages/core/src/index.js";
import { noopLogger } from "../../packages/core/src/index.js";
import { projectModelDiscoverer } from "../../packages/project-model/src/index.js";
import { graphProjectIndexer } from "../../packages/graph/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/graph/module-links");

function configFor(root: string): AnalyzerConfig {
  return {
    root,
    profile: "standard",
    ignore: { patterns: [], respectGitignore: true },
    incremental: { enabled: false },
    sandbox: { enabled: true, networkAccess: false },
  };
}

function spyLogger(): Logger & { debug: ReturnType<typeof vi.fn> } {
  return {
    ...noopLogger,
    debug: vi.fn(),
  };
}

describe("graphProjectIndexer", () => {
  it("returns a moduleGraph and symbolGraph built from real discovery+parsing, and logs their actual node/edge counts", async () => {
    const project = await projectModelDiscoverer.discover(FIXTURES_ROOT, configFor(FIXTURES_ROOT), noopLogger);
    const logger = spyLogger();

    const { project: indexed, graphs } = await graphProjectIndexer.index(project, logger);

    // Real modules were parsed (not a fixture double) -- proves this indexer actually ran Phase 2 parsing.
    expect(indexed.modules.length).toBeGreaterThan(0);
    expect(graphs.moduleGraph).toBeDefined();
    expect(graphs.symbolGraph).toBeDefined();
    expect(graphs.callGraph).toBeDefined();
    expect(graphs.taintGraph).toBeDefined();

    // The moduleGraph has one node per parsed module.
    expect(graphs.moduleGraph!.nodeCount).toBe(indexed.modules.length);
    expect(graphs.moduleGraph!.edgeCount).toBeGreaterThan(0);

    // logger.debug must be called with the *actual* counts off the returned graphs, not just
    // called-with-something -- this is the assertion end-to-end.test.ts never makes.
    expect(logger.debug).toHaveBeenCalledWith("graph construction complete", {
      moduleGraphNodes: graphs.moduleGraph!.nodeCount,
      moduleGraphEdges: graphs.moduleGraph!.edgeCount,
      symbolGraphNodes: graphs.symbolGraph!.nodeCount,
      symbolGraphEdges: graphs.symbolGraph!.edgeCount,
      callGraphNodes: graphs.callGraph!.nodeCount,
      callGraphEdges: graphs.callGraph!.edgeCount,
      taintGraphNodes: graphs.taintGraph!.nodeCount,
      taintGraphEdges: graphs.taintGraph!.edgeCount,
    });
  });
});
