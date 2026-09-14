import type { EdgeId, EdgeRelationType, NodeId } from "@code-analyzer/core";

/** Deterministic node/edge IDs — same discipline as Phase 1/2 (ADR-0005/ADR-0006): re-building the
 *  graph from unchanged input must yield identical IDs. */

export type GraphNodeType = "module" | "symbol" | "function" | "class";

export function moduleNodeId(moduleId: string): NodeId {
  return `module:${moduleId}` as NodeId;
}

export function symbolNodeId(symbolId: string): NodeId {
  return `symbol:${symbolId}` as NodeId;
}

export function functionNodeId(functionId: string): NodeId {
  return `function:${functionId}` as NodeId;
}

export function classNodeId(classId: string): NodeId {
  return `class:${classId}` as NodeId;
}

export function edgeId(type: EdgeRelationType, fromNodeId: NodeId, toNodeId: NodeId): EdgeId {
  return `${type}:${fromNodeId}->${toNodeId}` as EdgeId;
}
