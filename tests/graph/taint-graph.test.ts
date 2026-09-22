import { describe, expect, it } from "vitest";
import { buildTaintGraph, functionNodeId, InMemoryGraph, edgeId } from "../../packages/graph/src/index.js";
import type { CallSite, FileId, FunctionEntity, FunctionId, ModuleId, SourceLocation, SymbolId } from "../../packages/core/src/index.js";

function loc(path: string): SourceLocation {
  return { fileId: path as FileId, path };
}

function callSite(overrides: Partial<CallSite>): CallSite {
  return {
    calleeKind: "identifier",
    isNewExpression: false,
    argumentCount: 0,
    hasFunctionArgument: false,
    location: loc("f.ts"),
    ...overrides,
  };
}

function fn(overrides: Partial<FunctionEntity> & { id: string; name: string }): FunctionEntity {
  return {
    id: overrides.id as FunctionId,
    symbolId: `sym:${overrides.id}` as SymbolId,
    moduleId: "mod:f" as ModuleId,
    name: overrides.name,
    flavor: "function-declaration",
    parameters: [],
    isAsync: false,
    isGenerator: false,
    isExported: false,
    location: loc("f.ts"),
    calls: [],
    ...overrides,
  };
}

const reqQuerySite = callSite({ calleeKind: "member", calleeName: "toString", receiverText: "req.query.id" });
const dbQuerySite = callSite({ calleeKind: "member", calleeName: "query", receiverText: "db" });
const sanitizerSite = callSite({ calleeKind: "identifier", calleeName: "parseInt" });
const loggingSite = callSite({ calleeKind: "identifier", calleeName: "console.log" });

describe("buildTaintGraph", () => {
  it("produces an unsanitized FLOWS_TO edge for a direct source+sink within one function", () => {
    const handler = fn({ id: "f1", name: "handler", calls: [reqQuerySite, dbQuerySite] });
    const callGraph = new InMemoryGraph();
    const taintGraph = buildTaintGraph([handler], callGraph);

    const id = edgeId("FLOWS_TO", functionNodeId(handler.id), functionNodeId(handler.id));
    const edge = taintGraph.getEdge(id);
    expect(edge).toBeDefined();
    expect(edge?.certainty).toBe("direct");
    expect(edge?.data?.sanitized).toBe(false);
    expect(edge?.data?.sourceKind).toBe("query-parameter");
    expect(edge?.data?.sinkKind).toBe("sql");
  });

  it("produces a FLOWS_TO edge across two functions connected by a direct CALLS edge", () => {
    const source = fn({ id: "src", name: "source", calls: [reqQuerySite] });
    const sink = fn({ id: "snk", name: "sink", calls: [dbQuerySite] });
    const callGraph = new InMemoryGraph();
    callGraph.addNode({ id: functionNodeId(source.id), type: "function", entityId: source.id });
    callGraph.addNode({ id: functionNodeId(sink.id), type: "function", entityId: sink.id });
    callGraph.addEdge({
      id: edgeId("CALLS", functionNodeId(source.id), functionNodeId(sink.id)),
      type: "CALLS",
      fromNodeId: functionNodeId(source.id),
      toNodeId: functionNodeId(sink.id),
      certainty: "direct",
    });

    const taintGraph = buildTaintGraph([source, sink], callGraph);
    const id = edgeId("FLOWS_TO", functionNodeId(source.id), functionNodeId(sink.id));
    const edge = taintGraph.getEdge(id);
    expect(edge).toBeDefined();
    expect(edge?.certainty).toBe("direct");
    expect(edge?.data?.sanitized).toBe(false);
  });

  it("marks sanitized: true when a recognized sanitizer sits in an intermediate function on the path", () => {
    const source = fn({ id: "src2", name: "source", calls: [reqQuerySite] });
    const middle = fn({ id: "mid2", name: "middle", calls: [sanitizerSite] });
    const sink = fn({ id: "snk2", name: "sink", calls: [dbQuerySite] });
    const callGraph = new InMemoryGraph();
    for (const f of [source, middle, sink]) callGraph.addNode({ id: functionNodeId(f.id), type: "function", entityId: f.id });
    callGraph.addEdge({
      id: edgeId("CALLS", functionNodeId(source.id), functionNodeId(middle.id)),
      type: "CALLS",
      fromNodeId: functionNodeId(source.id),
      toNodeId: functionNodeId(middle.id),
      certainty: "direct",
    });
    callGraph.addEdge({
      id: edgeId("CALLS", functionNodeId(middle.id), functionNodeId(sink.id)),
      type: "CALLS",
      fromNodeId: functionNodeId(middle.id),
      toNodeId: functionNodeId(sink.id),
      certainty: "direct",
    });

    const taintGraph = buildTaintGraph([source, middle, sink], callGraph);
    const id = edgeId("FLOWS_TO", functionNodeId(source.id), functionNodeId(sink.id));
    const edge = taintGraph.getEdge(id);
    expect(edge).toBeDefined();
    expect(edge?.data?.sanitized).toBe(true);
  });

  it("still produces a FLOWS_TO edge, with reduced certainty, through a dynamic/unknown CALLS edge", () => {
    const source = fn({ id: "src3", name: "source", calls: [reqQuerySite] });
    const sink = fn({ id: "snk3", name: "sink", calls: [dbQuerySite] });
    const callGraph = new InMemoryGraph();
    callGraph.addNode({ id: functionNodeId(source.id), type: "function", entityId: source.id });
    callGraph.addNode({ id: functionNodeId(sink.id), type: "function", entityId: sink.id });
    callGraph.addEdge({
      id: edgeId("CALLS", functionNodeId(source.id), functionNodeId(sink.id)),
      type: "CALLS",
      fromNodeId: functionNodeId(source.id),
      toNodeId: functionNodeId(sink.id),
      certainty: "dynamic",
    });

    const taintGraph = buildTaintGraph([source, sink], callGraph);
    const id = edgeId("FLOWS_TO", functionNodeId(source.id), functionNodeId(sink.id));
    const edge = taintGraph.getEdge(id);
    expect(edge).toBeDefined();
    expect(edge?.certainty).toBe("dynamic");
  });

  it("produces zero edges when a source has no reachable sink and a sink has no reachable source", () => {
    const source = fn({ id: "src4", name: "source", calls: [reqQuerySite] });
    const sink = fn({ id: "snk4", name: "sink", calls: [dbQuerySite] });
    const unrelated = fn({ id: "unrelated4", name: "unrelated", calls: [] });
    const callGraph = new InMemoryGraph();
    for (const f of [source, sink, unrelated]) callGraph.addNode({ id: functionNodeId(f.id), type: "function", entityId: f.id });
    // No CALLS edge at all between source and sink -> unreachable.

    const taintGraph = buildTaintGraph([source, sink, unrelated], callGraph);
    expect(taintGraph.edgeCount).toBe(0);
  });

  it("produces an empty graph when no source or sink is present at all", () => {
    const plain = fn({ id: "plain5", name: "plain", calls: [loggingSite] });
    const callGraph = new InMemoryGraph();
    callGraph.addNode({ id: functionNodeId(plain.id), type: "function", entityId: plain.id });

    const taintGraph = buildTaintGraph([plain], callGraph);
    expect(taintGraph.edgeCount).toBe(0);
  });
});
