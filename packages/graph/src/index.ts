/**
 * @code-analyzer/graph — Phase 3 (Graph Foundation) + Phase 4 (Call Graph). In-process `Graph`
 * implementation (ADR-0003), Module Graph, Symbol Graph, and Call Graph builders. See
 * docs/tasks/phase-3-graph-foundation.md and docs/tasks/phase-4-call-graph.md.
 */
export { InMemoryGraph } from "./in-memory-graph.js";
export { buildModuleGraph } from "./module-graph.js";
export { buildSymbolGraph } from "./symbol-graph.js";
export { buildCallGraph } from "./call-graph.js";
export { buildTaintGraph } from "./taint-graph.js";
export type { TaintFlowEdgeData } from "./taint-graph.js";
export { graphProjectIndexer } from "./project-indexer.js";
export { moduleNodeId, symbolNodeId, functionNodeId, classNodeId, edgeId } from "./node-ids.js";
export type { GraphNodeType } from "./node-ids.js";
export { TAINT_SIGNATURES, matchesCallSite } from "./taint-signatures.js";
export type { TaintSignature, TaintSignatureKind, CallShapeMatch } from "./taint-signatures.js";
