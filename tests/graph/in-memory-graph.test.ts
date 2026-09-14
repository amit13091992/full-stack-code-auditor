import { describe, expect, it } from "vitest";
import type { EdgeId, NodeId } from "../../packages/core/src/index.js";
import { InMemoryGraph } from "../../packages/graph/src/index.js";

function node(id: string, type = "thing", entityId = id) {
  return { id: id as NodeId, type, entityId };
}
function edge(id: string, type: "IMPORTS" | "DECLARES" | "EXTENDS", from: string, to: string, certainty: "resolved" | "direct" = "resolved") {
  return { id: id as EdgeId, type, fromNodeId: from as NodeId, toNodeId: to as NodeId, certainty };
}

describe("InMemoryGraph", () => {
  it("adds nodes/edges and looks them up by ID", () => {
    const graph = new InMemoryGraph();
    graph.addNode(node("a"));
    graph.addNode(node("b"));
    graph.addEdge(edge("a->b", "IMPORTS", "a", "b"));

    expect(graph.getNode("a" as NodeId)).toBeDefined();
    expect(graph.getEdge("a->b" as EdgeId)).toBeDefined();
    expect(graph.nodeCount).toBe(2);
    expect(graph.edgeCount).toBe(1);
  });

  it("throws when adding an edge referencing a node that doesn't exist", () => {
    const graph = new InMemoryGraph();
    graph.addNode(node("a"));
    expect(() => graph.addEdge(edge("a->missing", "IMPORTS", "a", "missing"))).toThrow();
  });

  it("neighbors() returns only nodes reachable by the requested edge type", () => {
    const graph = new InMemoryGraph();
    graph.addNode(node("a"));
    graph.addNode(node("b"));
    graph.addNode(node("c"));
    graph.addEdge(edge("a->b", "IMPORTS", "a", "b"));
    graph.addEdge(edge("a->c", "DECLARES", "a", "c"));

    expect(graph.neighbors("a" as NodeId).map((n) => n.id).sort()).toEqual(["b", "c"]);
    expect(graph.neighbors("a" as NodeId, "IMPORTS").map((n) => n.id)).toEqual(["b"]);
    expect(graph.neighbors("a" as NodeId, "DECLARES").map((n) => n.id)).toEqual(["c"]);
  });

  it("query() filters by edgeType, fromNodeId, and toNodeId", () => {
    const graph = new InMemoryGraph();
    graph.addNode(node("a"));
    graph.addNode(node("b"));
    graph.addNode(node("c"));
    graph.addEdge(edge("a->b", "IMPORTS", "a", "b"));
    graph.addEdge(edge("a->c", "DECLARES", "a", "c"));

    expect(graph.query({}).length).toBe(2);
    expect(graph.query({ edgeType: "IMPORTS" }).length).toBe(1);
    expect(graph.query({ fromNodeId: "a" as NodeId }).length).toBe(2);
    expect(graph.query({ toNodeId: "b" as NodeId }).length).toBe(1);
  });

  it("query() filters by nodeType, matching an edge whose from- or to-node has that type", () => {
    const graph = new InMemoryGraph();
    graph.addNode(node("m", "module"));
    graph.addNode(node("s", "symbol"));
    graph.addNode(node("f", "function"));
    graph.addEdge(edge("m->s", "DECLARES", "m", "s"));
    graph.addEdge(edge("m->f", "DECLARES", "m", "f"));

    // "symbol" only matches the m->s edge (toNode type), not m->f.
    expect(graph.query({ nodeType: "symbol" }).map((e) => e.id)).toEqual(["m->s"]);
    // "module" matches both edges since it's the fromNode type on each.
    expect(graph.query({ nodeType: "module" }).map((e) => e.id).sort()).toEqual(["m->f", "m->s"]);
    // A node type that appears nowhere in the graph matches nothing.
    expect(graph.query({ nodeType: "class" })).toEqual([]);
  });

  it("findPaths() returns the shortest path(s) and respects maxDepth", () => {
    const graph = new InMemoryGraph();
    for (const id of ["a", "b", "c", "d"]) graph.addNode(node(id));
    graph.addEdge(edge("a->b", "IMPORTS", "a", "b"));
    graph.addEdge(edge("b->c", "IMPORTS", "b", "c"));
    graph.addEdge(edge("c->d", "IMPORTS", "c", "d"));
    graph.addEdge(edge("a->d", "IMPORTS", "a", "d")); // a shortcut directly to d

    const paths = graph.findPaths("a" as NodeId, "d" as NodeId);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.edges).toHaveLength(1); // the direct a->d edge, not the 3-hop path

    const noPath = graph.findPaths("a" as NodeId, "d" as NodeId, 0);
    expect(noPath).toEqual([]);
  });

  it("findPaths() does not loop forever on a cycle", () => {
    const graph = new InMemoryGraph();
    graph.addNode(node("a"));
    graph.addNode(node("b"));
    graph.addEdge(edge("a->b", "IMPORTS", "a", "b"));
    graph.addEdge(edge("b->a", "IMPORTS", "b", "a"));

    const paths = graph.findPaths("a" as NodeId, "b" as NodeId);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.edges).toHaveLength(1);
  });

  it("findPaths() returns [] for nodes that don't exist or aren't connected", () => {
    const graph = new InMemoryGraph();
    graph.addNode(node("a"));
    graph.addNode(node("b"));
    expect(graph.findPaths("a" as NodeId, "b" as NodeId)).toEqual([]);
    expect(graph.findPaths("a" as NodeId, "missing" as NodeId)).toEqual([]);
  });
});
