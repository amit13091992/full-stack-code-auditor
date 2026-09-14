/**
 * @code-analyzer/graph — Phase 3 (Graph Foundation). In-process `Graph` implementation (ADR-0003),
 * Module Graph and Symbol Graph builders. See docs/tasks/phase-3-graph-foundation.md.
 */
export { InMemoryGraph } from "./in-memory-graph.js";
export { buildModuleGraph } from "./module-graph.js";
export { buildSymbolGraph } from "./symbol-graph.js";
export { graphProjectIndexer } from "./project-indexer.js";
export { moduleNodeId, symbolNodeId, functionNodeId, classNodeId, edgeId } from "./node-ids.js";
export type { GraphNodeType } from "./node-ids.js";
