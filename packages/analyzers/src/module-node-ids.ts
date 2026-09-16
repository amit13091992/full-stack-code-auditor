import type { NodeId } from "@code-analyzer/core";

/**
 * Mirrors `@code-analyzer/graph`'s `moduleNodeId` (packages/graph/src/node-ids.ts) without taking a
 * dependency on that package — these analyzers only need the deterministic `module:<id>` node-id
 * format to query `context.graphs.moduleGraph`, not the graph builders themselves, and
 * `packages/analyzers` staying independent of `packages/graph` keeps the package graph a DAG rooted
 * only at `core` (ADR-0001).
 */
export function moduleNodeId(moduleId: string): NodeId {
  return `module:${moduleId}` as NodeId;
}
