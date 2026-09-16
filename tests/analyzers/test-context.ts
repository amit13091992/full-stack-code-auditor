import type { AnalyzerConfig, AnalyzerContext } from "../../packages/core/src/index.js";
import { noopLogger } from "../../packages/core/src/index.js";
import { projectModelDiscoverer } from "../../packages/project-model/src/index.js";
import { graphProjectIndexer } from "../../packages/graph/src/index.js";

export function configFor(root: string): AnalyzerConfig {
  return {
    root,
    profile: "standard",
    ignore: { patterns: [], respectGitignore: true },
    incremental: { enabled: false },
    sandbox: { enabled: true, networkAccess: false },
  };
}

/** Real discovery -> real parsing -> real graph-building, so analyzer unit tests exercise real data (Section 30). */
export async function buildAnalyzerContext(root: string): Promise<AnalyzerContext> {
  const config = configFor(root);
  const discovered = await projectModelDiscoverer.discover(root, config, noopLogger);
  const indexed = await graphProjectIndexer.index(discovered, noopLogger);

  return {
    scanId: "test-scan" as never,
    project: indexed.project,
    frameworks: indexed.project.frameworks,
    graphs: indexed.graphs,
    config,
    logger: noopLogger,
    events: { on: () => () => {}, emit: () => {} },
    signal: new AbortController().signal,
  };
}
