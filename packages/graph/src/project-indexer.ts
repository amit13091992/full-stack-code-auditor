import type { Diagnostic, GraphAccess, Logger, ProjectIndexer, ProjectModel } from "@code-analyzer/core";
import { parserProjectIndexer } from "@code-analyzer/parser";
import { buildCallGraph } from "./call-graph.js";
import { buildModuleGraph } from "./module-graph.js";
import { buildSymbolGraph } from "./symbol-graph.js";
import { buildTaintGraph } from "./taint-graph.js";

/**
 * The `ProjectIndexer` (docs/tasks/phase-3-graph-foundation.md, extended by
 * docs/tasks/phase-4-call-graph.md and docs/tasks/phase-5-taint-graph.md): runs Phase 2's real
 * parsing (`parserProjectIndexer`) and then builds the Module Graph, Symbol Graph, Call Graph, and
 * Taint Graph over its output.
 * `dependencyGraph`/`applicationGraph` stay undefined — later phases.
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
    const callGraph = buildCallGraph(parsed.project.modules, parsed.project.functions, parsed.project.classes);
    const taintGraph = buildTaintGraph(parsed.project.functions, callGraph);

    logger.debug("graph construction complete", {
      moduleGraphNodes: moduleGraph.nodeCount,
      moduleGraphEdges: moduleGraph.edgeCount,
      symbolGraphNodes: symbolGraph.nodeCount,
      symbolGraphEdges: symbolGraph.edgeCount,
      callGraphNodes: callGraph.nodeCount,
      callGraphEdges: callGraph.edgeCount,
      taintGraphNodes: taintGraph.nodeCount,
      taintGraphEdges: taintGraph.edgeCount,
    });

    return {
      project: parsed.project,
      graphs: { moduleGraph, symbolGraph, callGraph, taintGraph },
      diagnostics: parsed.diagnostics,
    };
  },
};
