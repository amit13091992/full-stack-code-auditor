import type { Diagnostic, GraphAccess, Logger, ProjectIndexer, ProjectModel } from "@code-analyzer/core";
import { parserProjectIndexer } from "@code-analyzer/parser";
import { buildModuleGraph } from "./module-graph.js";
import { buildSymbolGraph } from "./symbol-graph.js";

/**
 * The Phase 3 `ProjectIndexer` (docs/tasks/phase-3-graph-foundation.md): runs Phase 2's real
 * parsing (`parserProjectIndexer`) and then builds the Module Graph and Symbol Graph over its
 * output. `callGraph`/`taintGraph`/`dependencyGraph`/`applicationGraph` stay undefined — Phase 4+.
 *
 * `@code-analyzer/graph` depending on `@code-analyzer/parser` here (not just `core`) is a
 * deliberate, non-cyclic choice: graph construction is inherently a step *after* parsing, and
 * ADR-0001 only requires every package depend on `core` — it doesn't forbid one non-core package
 * depending on another's exported contract, only reaching into its internals (which this doesn't).
 */
export const graphProjectIndexer: ProjectIndexer = {
  async index(
    project: ProjectModel,
    logger: Logger,
  ): Promise<{ project: ProjectModel; graphs: GraphAccess; diagnostics: readonly Diagnostic[] }> {
    const parsed = await parserProjectIndexer.index(project, logger);

    const moduleGraph = buildModuleGraph(parsed.project.modules);
    const symbolGraph = buildSymbolGraph(parsed.project.modules, parsed.project.symbols, parsed.project.functions, parsed.project.classes);

    logger.debug("graph construction complete", {
      moduleGraphNodes: moduleGraph.nodeCount,
      moduleGraphEdges: moduleGraph.edgeCount,
      symbolGraphNodes: symbolGraph.nodeCount,
      symbolGraphEdges: symbolGraph.edgeCount,
    });

    return {
      project: parsed.project,
      graphs: { moduleGraph, symbolGraph },
      diagnostics: parsed.diagnostics,
    };
  },
};
