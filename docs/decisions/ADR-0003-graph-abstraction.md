# ADR-0003: In-Process Graph Abstraction (Not a Graph Database)

## Status

Accepted

## Context

Section 2 requires a Module Graph, Dependency Graph, Symbol Graph, Call Graph, Taint Graph, and
Application Knowledge Graph. Section 4 explicitly says: "Design an internal graph abstraction
first. Do not couple the core domain model directly to Neo4j or another graph database. Initially
prefer in-process graph structures and persistent artifacts where practical."

## Decision

`packages/core/src/graph/graph.ts` defines a single `Graph<TNodeData, TEdgeData>` interface:
typed nodes (`GraphNode`), typed edges with a closed `EdgeRelationType` union (`IMPORTS`,
`EXPORTS`, `DECLARES`, `REFERENCES`, `CALLS`, `EXTENDS`, `IMPLEMENTS`, `DEPENDS_ON` — Section 3),
and an `EdgeCertainty` union (`direct | resolved | inferred | dynamic | unknown` — Section 4) so
dynamic JS/TS call resolution is represented, never silently dropped.

`core` ships only the interface. `packages/graph` will provide the concrete implementation(s):
an in-memory adjacency-list graph for normal scans, with a serialized/persisted form for
incremental-analysis caching (Section 29). No package in Phase 0-5 may import a graph database
client; `AnalyzerContext.graphs` in `core` is typed against the `Graph` interface only.

## Alternatives considered

- **Adopt Neo4j (or another graph DB) now.** Rejected per explicit Section 4 instruction, and
  because it would make the analyzer's core loop depend on an external service being available —
  incompatible with Section 31 (repository contents are hostile input; the analyzer must not need
  network access to run a standard scan) and Section 5.7 (deterministic analysis wherever possible,
  no incidental infra dependency).
- **One Graph class per graph kind** (`ModuleGraph`, `CallGraph`, ... as distinct types). Rejected:
  they share identical traversal/query semantics; distinguishing them by the `type` field on
  `GraphNode`/`GraphEdge` and by which `AnalyzerContext.graphs.*` slot holds them is sufficient, and
  avoids five near-duplicate interfaces.
- **Expose a query language (Cypher-like) instead of a typed method surface.** Deferred: adds
  parsing/execution complexity Phase 0 does not need. `query()` + `findPaths()` covers the taint-path
  reconstruction and architecture-rule use cases in Sections 6 and 16; revisit only if analyzer
  authors hit real expressiveness limits.

## Consequences

- A future graph-database-backed implementation of `Graph` is possible without touching any
  analyzer, because analyzers only ever depend on the interface via `AnalyzerContext`.
- `packages/graph` owns all traversal algorithms (path reconstruction for Section 6's
  source→sink chains, cycle detection for Section 16's architecture rules).
- Performance-sensitive graph operations may later move to a native module (Section 4: "keep the
  architecture open for Rust-based workers... introduce it only where profiling demonstrates a
  meaningful need") behind the same `Graph` interface — this ADR does not block that, it only
  blocks jumping straight to an external graph database.
