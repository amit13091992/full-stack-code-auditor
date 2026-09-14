import type { ClassEntity, FunctionEntity, Graph, Module, Symbol as SymbolEntity } from "@code-analyzer/core";
import { InMemoryGraph } from "./in-memory-graph.js";
import { classNodeId, edgeId, functionNodeId, moduleNodeId, symbolNodeId } from "./node-ids.js";

/**
 * Builds the Symbol Graph (Phase 3): one node per `Symbol`/`FunctionEntity`/`ClassEntity`,
 * `DECLARES` edges from each module to everything it declares, and `EXTENDS`/`IMPLEMENTS` edges
 * from a `ClassEntity` to whatever same-file symbol Phase 2 already resolved
 * (`extendsSymbolId`/`implementsSymbolIds` — cross-file class relationships stay unresolved this
 * phase too, same reasoning as Module Graph's external-specifier limitation).
 */
export function buildSymbolGraph(
  modules: readonly Module[],
  symbols: readonly SymbolEntity[],
  functions: readonly FunctionEntity[],
  classes: readonly ClassEntity[],
): Graph {
  const graph = new InMemoryGraph();

  for (const module of modules) {
    graph.addNode({ id: moduleNodeId(module.id), type: "module", entityId: module.id });
  }
  for (const symbol of symbols) {
    graph.addNode({ id: symbolNodeId(symbol.id), type: "symbol", entityId: symbol.id });
  }
  for (const fn of functions) {
    graph.addNode({ id: functionNodeId(fn.id), type: "function", entityId: fn.id });
  }
  for (const cls of classes) {
    graph.addNode({ id: classNodeId(cls.id), type: "class", entityId: cls.id });
  }

  for (const module of modules) {
    const fromId = moduleNodeId(module.id);
    for (const symbolId of module.declaredSymbols) {
      const toId = symbolNodeId(symbolId);
      if (!graph.getNode(toId)) continue;
      graph.addEdge({ id: edgeId("DECLARES", fromId, toId), type: "DECLARES", fromNodeId: fromId, toNodeId: toId, certainty: "direct" });
    }
  }

  // Every top-level FunctionEntity/ClassEntity has a backing Symbol (parse-file.ts's addSymbol),
  // so module.declaredSymbols already covers them via the DECLARES loop above — this loop instead
  // adds direct module -> function/class DECLARES edges for callers that query by "function"/
  // "class" node type without following the intermediate symbol.
  for (const fn of functions) {
    if (fn.ownerClassId) continue; // methods are owned by their class, not declared by the module directly
    const moduleNode = moduleNodeId(fn.moduleId);
    if (!graph.getNode(moduleNode)) continue;
    const toId = functionNodeId(fn.id);
    graph.addEdge({ id: edgeId("DECLARES", moduleNode, toId), type: "DECLARES", fromNodeId: moduleNode, toNodeId: toId, certainty: "direct" });
  }
  for (const cls of classes) {
    const moduleNode = moduleNodeId(cls.moduleId);
    if (!graph.getNode(moduleNode)) continue;
    const toId = classNodeId(cls.id);
    graph.addEdge({ id: edgeId("DECLARES", moduleNode, toId), type: "DECLARES", fromNodeId: moduleNode, toNodeId: toId, certainty: "direct" });
  }

  for (const cls of classes) {
    const fromId = classNodeId(cls.id);
    if (cls.extendsSymbolId) {
      const toId = symbolNodeId(cls.extendsSymbolId);
      if (graph.getNode(toId)) {
        graph.addEdge({ id: edgeId("EXTENDS", fromId, toId), type: "EXTENDS", fromNodeId: fromId, toNodeId: toId, certainty: "resolved" });
      }
    }
    for (const implementsId of cls.implementsSymbolIds) {
      const toId = symbolNodeId(implementsId);
      if (!graph.getNode(toId)) continue;
      graph.addEdge({ id: edgeId("IMPLEMENTS", fromId, toId), type: "IMPLEMENTS", fromNodeId: fromId, toNodeId: toId, certainty: "resolved" });
    }
  }

  return graph;
}
