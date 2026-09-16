import type { EdgeId, EdgeRelationType, Graph, GraphEdge, GraphNode, GraphQuery, NodeId, PathResult } from "@code-analyzer/core";

/**
 * `findPaths` explores every shortest path, not just one — without a bound, a densely-connected
 * graph (a malicious or pathological repository is untrusted input, Section 31) can make it
 * enqueue exponentially many partial paths before a single frame is dequeued past this limit. This
 * is a conservative stopgap bound, not a tuned value — same reasoning as
 * `MAX_PARSEABLE_FILE_SIZE_BYTES` (`packages/parser/src/project-indexer.ts`): close the DoS vector
 * now rather than wait for a Phase 4+ analyzer to pick a number, and revisit with real
 * large-repository profiling data once one exists.
 */
const MAX_FIND_PATHS_FRAMES_EXPANDED = 50_000;

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
   *
   * Bounded by `MAX_FIND_PATHS_FRAMES_EXPANDED` (security stopgap, see above): once that many
   * partial paths have been dequeued, the search stops and returns whatever shortest paths it has
   * already found rather than continuing to explore. On a graph this dense that bound is a signal
   * something is wrong with the input, not a real "no path exists" answer — callers should not
   * treat an empty/partial result as proof of unreachability without also checking `nodeCount`/
   * `edgeCount` for a graph size that's plausible for the bound to have engaged.
   */
  findPaths(fromNodeId: NodeId, toNodeId: NodeId, maxDepth = 10): readonly PathResult[] {
    if (!this.nodes.has(fromNodeId) || !this.nodes.has(toNodeId)) return [];
    if (fromNodeId === toNodeId) return [{ nodes: [this.nodes.get(fromNodeId)!], edges: [] }];

    type Frame = { nodeId: NodeId; nodes: GraphNode<TNodeData>[]; edges: GraphEdge<TEdgeData>[] };
    const startNode = this.nodes.get(fromNodeId)!;
    // Index-based queue (not Array.shift(), which is O(n)) — with the frame cap below the queue
    // can still grow to tens of thousands of entries on a dense graph, and shift()ing off a
    // large array turns the whole search O(n^2).
    const queue: Frame[] = [{ nodeId: fromNodeId, nodes: [startNode], edges: [] }];
    let queueHead = 0;
    const results: PathResult[] = [];
    let shortestLength: number | undefined;
    let framesExpanded = 0;
    let framesEnqueued = 1;

    while (queueHead < queue.length) {
      if (framesExpanded >= MAX_FIND_PATHS_FRAMES_EXPANDED) break;
      const current = queue[queueHead++]!;
      framesExpanded++;
      if (current.edges.length >= maxDepth) continue;
      if (shortestLength !== undefined && current.edges.length >= shortestLength) continue;

      const outgoingEdgeIds = this.outgoing.get(current.nodeId) ?? new Set<EdgeId>();
      for (const edgeId of outgoingEdgeIds) {
        if (framesEnqueued >= MAX_FIND_PATHS_FRAMES_EXPANDED) break;
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
          framesEnqueued++;
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
