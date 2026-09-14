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

`AnalyzerContext.graphs` (Phase-0 contract, `packages/core/src/analyzer/context.ts`) names six
optional slots. Phase 3 implemented and populates two of them:

- `moduleGraph` — **implemented (Phase 3)**: `IMPORTS` edges between modules, built by
  `buildModuleGraph` (`packages/graph/src/module-graph.ts`) resolving Phase 2's per-file
  `ImportBinding.specifier`s against the rest of the project. `EXPORTS` edges aren't built as graph
  edges — a module's exports are already directly available on `Module.exports`, no traversal
  needed for that.
- `symbolGraph` — **implemented (Phase 3)**: `DECLARES` edges (module → symbol/function/class) and
  `EXTENDS`/`IMPLEMENTS` edges (same-file only, from Phase 2's already-resolved data), built by
  `buildSymbolGraph` (`packages/graph/src/symbol-graph.ts`). `REFERENCES` edges are **not** built —
  Phase 2 never collected symbol-occurrence data to build them from (see `docs/project-status.md`).
- `dependencyGraph` — **not yet implemented**: `DEPENDS_ON` edges between packages, blocked on
  Section 13's `Dependency[]` actually existing (still deferred, ADR-0005) — see
  `docs/project-status.md`'s technical debt.
- `callGraph` — `CALLS` edges with `EdgeCertainty` (Phase 4, not yet implemented)
- `taintGraph` — source-to-sink propagation edges backing `DataFlow` reconstruction (Phase 5, not
  yet implemented)
- `applicationGraph` — the Section 16 application-level graph (services, security boundaries;
  Phase 6+, not yet implemented)

All six are optional on `GraphAccess` because a given `ScanProfile` may not build all of them
(e.g. `minimal` skips call/taint graphs entirely for speed, Section 28) — and, as of Phase 3, also
because three of them genuinely don't exist as real implementations yet.

## Path reconstruction

`Graph.findPaths(fromNodeId, toNodeId, maxDepth?)` is what backs Section 6's requirement that a
`DataFlow` finding show the full `source -> controller -> service -> repository -> sink` chain, and
Section 16's architecture-rule violation paths. `packages/graph` owns the traversal algorithm;
`core` only defines the shape of the result (`PathResult`).

## Phase 3: decided

`packages/graph`'s concrete implementation is **one generic adjacency-list structure**
(`InMemoryGraph`, `packages/graph/src/in-memory-graph.ts`), reused for both `moduleGraph` and
`symbolGraph` (and presumably `callGraph`/`taintGraph` when those land) rather than a bespoke
structure per slot — no profiling data suggested a need for anything more specialized yet
(Section 35.7/35.13: don't add complexity speculatively). `findPaths` is BFS-based (shortest path,
cycle-safe via a visited-in-this-path check, respects `maxDepth`).

## Not yet decided (deferred past Phase 3)

- Persistence format for incremental-analysis caching (Section 29) — the `Graph` interface still
  has no serialize/deserialize method; `InMemoryGraph` is rebuilt from scratch on every scan.
- Whether a `callGraph`/`taintGraph` genuinely wants the same `InMemoryGraph` structure or something
  more specialized — revisit with real data once Phase 4/5 are actually scoped, not before.
