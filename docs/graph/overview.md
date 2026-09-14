# Graph Model

See ADR-0003 for why this is an in-process abstraction, not a graph database.

Contract: `packages/core/src/graph/graph.ts` — `Graph<TNodeData, TEdgeData>`.

## Node and edge identity

- `GraphNode.entityId` links a graph node back to a domain entity ID (a `SymbolId`, `FunctionId`,
  `ModuleId`, etc.) — the graph never duplicates domain data, it references it.
- `GraphEdge.type` is one of the eight relation types from Section 3: `IMPORTS`, `EXPORTS`,
  `DECLARES`, `REFERENCES`, `CALLS`, `EXTENDS`, `IMPLEMENTS`, `DEPENDS_ON`.
- `GraphEdge.certainty` (Section 4) is mandatory on every edge: `direct | resolved | inferred |
  dynamic | unknown`. A `CALLS` edge produced by resolving `obj[methodName]()` where `methodName` is
  a runtime string must be `dynamic` or `unknown`, never silently omitted or asserted as `direct`.

## Which graph is which

`AnalyzerContext.graphs` (Phase-0 contract, `packages/core/src/analyzer/context.ts`) names five
optional slots, each a `Graph` instance built by `packages/graph`:

- `moduleGraph` — `IMPORTS`/`EXPORTS` edges between modules (Phase 3)
- `dependencyGraph` — `DEPENDS_ON` edges between packages (Phase 3)
- `symbolGraph` — `DECLARES`/`REFERENCES` edges (Phase 3)
- `callGraph` — `CALLS` edges with `EdgeCertainty` (Phase 4)
- `taintGraph` — source-to-sink propagation edges backing `DataFlow` reconstruction (Phase 5)
- `applicationGraph` — the Section 16 application-level graph (services, security boundaries)

All five are optional on `GraphAccess` because a given `ScanProfile` may not build all of them
(e.g. `minimal` skips call/taint graphs entirely for speed, Section 28).

## Path reconstruction

`Graph.findPaths(fromNodeId, toNodeId, maxDepth?)` is what backs Section 6's requirement that a
`DataFlow` finding show the full `source -> controller -> service -> repository -> sink` chain, and
Section 16's architecture-rule violation paths. `packages/graph` owns the traversal algorithm;
`core` only defines the shape of the result (`PathResult`).

## Not yet decided (deferred past Phase 0)

- Whether `packages/graph`'s concrete implementation is a single generic adjacency-list graph
  reused for all five slots, or five specialized structures sharing the `Graph` interface. Either
  is valid against the Phase 0 contract; decide when Phase 3 is scoped, based on real profiling
  rather than speculation (Section 35.7/35.13).
- Persistence format for incremental-analysis caching (Section 29) — the `Graph` interface has no
  serialize/deserialize method yet because we don't want to freeze a cache format before Phase 3
  exists.
