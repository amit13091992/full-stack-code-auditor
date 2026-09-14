import type { EdgeId, EdgeRelationType, Graph, GraphEdge, GraphNode, GraphQuery, NodeId, PathResult } from "@code-analyzer/core";

/**
 * The concrete `Graph` implementation (ADR-0003: in-process, not a graph database). An
 * adjacency-list structure — `outgoing`/`incoming` map a `NodeId` to the `EdgeId`s leaving/
 * entering it, so `neighbors()` and `findPaths()` don't need to scan every edge.
 */
export class InMemoryGraph<TNodeData = unknown, TEdgeData = unknown> implements Graph<TNodeData, TEdgeData> {
  private readonly nodes = new Map<NodeId, GraphNode<TNodeData>>();
  private readonly edges = new Map<EdgeId, GraphEdge<TEdgeData>>();
  private readonly outgoing = new Map<NodeId, Set<EdgeId>>();
  private readonly incoming = new Map<NodeId, Set<EdgeId>>();

  addNode(node: GraphNode<TNodeData>): void {
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) this.outgoing.set(node.id, new Set());
    if (!this.incoming.has(node.id)) this.incoming.set(node.id, new Set());
  }

  addEdge(edge: GraphEdge<TEdgeData>): void {
    if (!this.nodes.has(edge.fromNodeId)) throw new Error(`Cannot add edge ${edge.id}: fromNodeId ${edge.fromNodeId} is not a node in this graph`);
    if (!this.nodes.has(edge.toNodeId)) throw new Error(`Cannot add edge ${edge.id}: toNodeId ${edge.toNodeId} is not a node in this graph`);
    this.edges.set(edge.id, edge);
    this.outgoing.get(edge.fromNodeId)?.add(edge.id);
    this.incoming.get(edge.toNodeId)?.add(edge.id);
  }

  getNode(id: NodeId): GraphNode<TNodeData> | undefined {
    return this.nodes.get(id);
  }

  getEdge(id: EdgeId): GraphEdge<TEdgeData> | undefined {
    return this.edges.get(id);
  }

  neighbors(id: NodeId, edgeType?: EdgeRelationType): readonly GraphNode<TNodeData>[] {
    const outgoingEdgeIds = this.outgoing.get(id) ?? new Set<EdgeId>();
    const result: GraphNode<TNodeData>[] = [];
    for (const edgeId of outgoingEdgeIds) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;
      if (edgeType && edge.type !== edgeType) continue;
      const target = this.nodes.get(edge.toNodeId);
      if (target) result.push(target);
    }
    return result;
  }

  query(query: GraphQuery): readonly GraphEdge<TEdgeData>[] {
    let candidates: Iterable<GraphEdge<TEdgeData>>;
    if (query.fromNodeId) {
      const ids = this.outgoing.get(query.fromNodeId) ?? new Set<EdgeId>();
      candidates = [...ids].map((id) => this.edges.get(id)).filter((e): e is GraphEdge<TEdgeData> => e !== undefined);
    } else if (query.toNodeId) {
      const ids = this.incoming.get(query.toNodeId) ?? new Set<EdgeId>();
      candidates = [...ids].map((id) => this.edges.get(id)).filter((e): e is GraphEdge<TEdgeData> => e !== undefined);
    } else {
      candidates = this.edges.values();
    }

    const results: GraphEdge<TEdgeData>[] = [];
    for (const edge of candidates) {
      if (query.edgeType && edge.type !== query.edgeType) continue;
      if (query.nodeType) {
        const fromNode = this.nodes.get(edge.fromNodeId);
        const toNode = this.nodes.get(edge.toNodeId);
        if (fromNode?.type !== query.nodeType && toNode?.type !== query.nodeType) continue;
      }
      if (query.fromNodeId && edge.fromNodeId !== query.fromNodeId) continue;
      if (query.toNodeId && edge.toNodeId !== query.toNodeId) continue;
      results.push(edge);
    }
    return results;
  }

  /**
   * Breadth-first search, returning every shortest path (there may be more than one of equal
   * length) up to `maxDepth` hops. No weighted-edge concept exists yet (Phase 3 scope), so "shortest"
   * means fewest edges.
   */
  findPaths(fromNodeId: NodeId, toNodeId: NodeId, maxDepth = 10): readonly PathResult[] {
    if (!this.nodes.has(fromNodeId) || !this.nodes.has(toNodeId)) return [];
    if (fromNodeId === toNodeId) return [{ nodes: [this.nodes.get(fromNodeId)!], edges: [] }];

    type Frame = { nodeId: NodeId; nodes: GraphNode<TNodeData>[]; edges: GraphEdge<TEdgeData>[] };
    const startNode = this.nodes.get(fromNodeId)!;
    const queue: Frame[] = [{ nodeId: fromNodeId, nodes: [startNode], edges: [] }];
    const results: PathResult[] = [];
    let shortestLength: number | undefined;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.edges.length >= maxDepth) continue;
      if (shortestLength !== undefined && current.edges.length >= shortestLength) continue;

      const outgoingEdgeIds = this.outgoing.get(current.nodeId) ?? new Set<EdgeId>();
      for (const edgeId of outgoingEdgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;
        // Avoid cycles within a single path (Section 16 needs cycle handling, not infinite loops).
        if (current.nodes.some((n) => n.id === edge.toNodeId)) continue;

        const nextNode = this.nodes.get(edge.toNodeId);
        if (!nextNode) continue;
        const nextFrame: Frame = { nodeId: edge.toNodeId, nodes: [...current.nodes, nextNode], edges: [...current.edges, edge] };

        if (edge.toNodeId === toNodeId) {
          shortestLength = nextFrame.edges.length;
          results.push({ nodes: nextFrame.nodes, edges: nextFrame.edges });
        } else {
          queue.push(nextFrame);
        }
      }
    }
    return results;
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }
}
