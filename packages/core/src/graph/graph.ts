import type { EdgeId, Metadata, NodeId } from "../domain/ids.js";

/**
 * The internal graph abstraction referenced in Section 2/3/4/5: an in-process representation
 * that the Module Graph, Dependency Graph, Symbol Graph, Call Graph, and Taint Graph are all
 * built on. Deliberately not coupled to any graph database — a persistence adapter can be added
 * later without changing this contract (Section 4 tech direction).
 */

export type EdgeRelationType =
  | "IMPORTS"
  | "EXPORTS"
  | "DECLARES"
  | "REFERENCES"
  | "CALLS"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "DEPENDS_ON";

/**
 * Confidence in a resolved relationship, most important for CALLS edges over dynamic JS/TS
 * (Section 4). Dynamic dispatch must be represented, never silently dropped.
 */
export type EdgeCertainty = "direct" | "resolved" | "inferred" | "dynamic" | "unknown";

export interface GraphNode<TData = unknown> {
  readonly id: NodeId;
  readonly type: string;
  readonly entityId: string;
  readonly data?: TData;
  readonly metadata?: Metadata;
}

export interface GraphEdge<TData = unknown> {
  readonly id: EdgeId;
  readonly type: EdgeRelationType;
  readonly fromNodeId: NodeId;
  readonly toNodeId: NodeId;
  readonly certainty: EdgeCertainty;
  readonly data?: TData;
  readonly metadata?: Metadata;
}

export interface GraphQuery {
  readonly nodeType?: string;
  readonly edgeType?: EdgeRelationType;
  readonly fromNodeId?: NodeId;
  readonly toNodeId?: NodeId;
}

export interface PathResult {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/** Read/write contract for any graph implementation (module graph, call graph, taint graph, ...). */
export interface Graph<TNodeData = unknown, TEdgeData = unknown> {
  addNode(node: GraphNode<TNodeData>): void;
  addEdge(edge: GraphEdge<TEdgeData>): void;
  getNode(id: NodeId): GraphNode<TNodeData> | undefined;
  getEdge(id: EdgeId): GraphEdge<TEdgeData> | undefined;
  neighbors(id: NodeId, edgeType?: EdgeRelationType): readonly GraphNode<TNodeData>[];
  query(query: GraphQuery): readonly GraphEdge<TEdgeData>[];
  findPaths(fromNodeId: NodeId, toNodeId: NodeId, maxDepth?: number): readonly PathResult[];
  readonly nodeCount: number;
  readonly edgeCount: number;
}
