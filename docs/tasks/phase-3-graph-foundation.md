# Task: Phase 3 — Graph Foundation (IMPLEMENTED — pending human review)

## Objective

Implement `@code-analyzer/graph`: a concrete in-process `Graph` implementation (ADR-0003) plus two
builders — a **Module Graph** (`IMPORTS` edges, resolving Phase 2's per-file `ImportBinding`
specifiers against the rest of the project — the cross-file resolution ADR-0006 explicitly deferred
to this phase) and a **Symbol Graph** (`DECLARES` edges from modules to their symbols, `EXTENDS`/
`IMPLEMENTS` edges from Phase 2's already-resolved same-file class relationships). Wire both into
`AnalyzerContext.graphs.moduleGraph`/`.symbolGraph` via a real graph-building `ProjectIndexer`.

## Scope

- **`packages/graph/src/in-memory-graph.ts`**: an adjacency-list `Graph` implementation (ADR-0003 —
  no graph database) — `addNode`/`addEdge`/`getNode`/`getEdge`/`neighbors`/`query`/`findPaths`
  (BFS, since Phase 3 has no weighted-edge use case yet).
- **Module Graph**: one `GraphNode` per `Module` (`type: "module"`, `entityId: ModuleId`). For every
  `ImportBinding` across every module, resolve `specifier` to a target module:
  - A relative specifier (`./x`, `../y`) resolves against the importing module's own directory,
    trying `.ts`/`.tsx`/`.js`/`.jsx` extensions and an `/index.*` fallback, against the actual set
    of parsed `Module`s. A match produces an `IMPORTS` edge with `certainty: "resolved"`.
  - A bare specifier (`"react"`, `"express"`, ...) or a relative specifier that doesn't match any
    parsed module (external package, or a file Phase 2 skipped — e.g. `generated`/`vendored`/
    oversized) produces **no edge** — there's no project-internal node to point an edge at. This is
    not silently dropped: `docs/project-status.md` records it as a known gap (bare-specifier/
    external-package resolution is Section 13/Phase 6+ territory, not Phase 3's).
  - `EdgeCertainty` beyond `"resolved"` (e.g. `"dynamic"` for `import()` calls whose specifier is
    itself dynamic, not a string literal) is out of scope this phase — Phase 2's `parseFile` only
    ever records a `dynamic` `ImportBinding` when the specifier *is* a string literal; a genuinely
    computed specifier (`import(someVar)`) isn't captured as an `ImportBinding` at all yet, and
    isn't in this phase's scope either.
- **Symbol Graph**: one `GraphNode` per `Symbol`/`FunctionEntity`/`ClassEntity` (`type: "symbol"` /
  `"function"` / `"class"`). `DECLARES` edges from each module's node to every symbol/function/class
  it declares. `EXTENDS`/`IMPLEMENTS` edges from each `ClassEntity` with a non-`undefined`
  `extendsSymbolId`/`implementsSymbolIds` (Phase 2 already resolved these for same-file targets) to
  the target symbol's node — `certainty: "resolved"` (same-file, deterministic).
- **`REFERENCES` edges are explicitly out of scope**: Phase 2 never collected `SymbolReference`
  occurrences (only declarations) — see Non-goals. `EdgeRelationType` already has `REFERENCES` in
  its union from Phase 0, but nothing populates it yet.
- **Wire into `AnalyzerContext.graphs`**: extend `packages/parser`'s composing `ProjectIndexer`
  (`parserProjectIndexer`) — rename/relocate to `packages/graph` if that's the cleaner boundary
  (decide during implementation; either is compatible with ADR-0001, `graph` already depends on
  `core` only) — so `index()` returns `graphs: { moduleGraph, symbolGraph }` instead of `{}`.

## Non-goals

- `REFERENCES` edges (identifier-occurrence tracking) — needs a real AST walk Phase 2 didn't do;
  revisit as its own small task once an analyzer actually needs it, don't build it speculatively.
- Call Graph, `EdgeCertainty` `dynamic`/`inferred` dispatch resolution (Phase 4).
- Taint Graph (Phase 5).
- Dependency Graph (`DEPENDS_ON` edges) from Section 13's `Dependency[]` — `ProjectModel.dependencies`
  is still empty (ADR-0005 deferral); building a graph over data that doesn't exist yet is backwards.
- Application Graph (services/security boundaries, Section 16) — Phase 6+.
- Resolving imports to `node_modules`/external packages — no package installation/resolution
  algorithm in scope; only same-project relative-import resolution.
- Persisting/serializing the graph for incremental-analysis caching (Section 29) — still deferred.
- **`ADR-0008`** (the `ProjectIndexer.index()` diagnostics-channel gap flagged during Phase 2
  review) — a separate, small, focused task; don't bundle it into this one just because both touch
  `ProjectIndexer`. Do it first if it's quick, but as its own reviewable change.

## Dependencies

Phase 2 (`ProjectModel.modules`/`.symbols`/`.functions`/`.classes` populated by real parsing).

## Files / packages affected

`packages/graph/src/**` (currently empty stub). Possibly `packages/parser/src/project-indexer.ts`
if the composing `ProjectIndexer` moves rather than gets a new sibling in `packages/graph`.

## Interface changes

None — `Graph`, `GraphAccess`, `EdgeRelationType`, `EdgeCertainty` are all already frozen in
`packages/core` from Phase 0 and already fit this scope exactly (checked against
`packages/core/src/graph/graph.ts` and `packages/core/src/analyzer/context.ts` before drafting this
spec). If implementation finds a genuine gap, that's an ADR + architect review, same rule as every
other phase.

## Implementation requirements

- No network access, no execution of repository content — this is pure in-memory graph
  construction over already-parsed `ProjectModel` data (Section 31).
- Deterministic: building the same `ProjectModel` twice produces the same node/edge sets (same
  `NodeId`/`EdgeId` derivation discipline as Phase 1/2's deterministic IDs).
- `findPaths` must return genuinely traceable node/edge sequences (Section 6/16 will depend on this
  later) — no approximated/synthetic paths.

## Tests

Fixtures under `fixtures/graph/` (new): a small multi-file project with real relative imports
between 2-3 files (some resolvable, one importing a bare/external specifier to prove the no-edge
case is handled cleanly) and a same-file class-extends/implements case (reuse `fixtures/parser/
basic-constructs/shapes.ts`'s pattern or a dedicated fixture). Unit tests for `in-memory-graph.ts`
(`addNode`/`addEdge`/`neighbors`/`query`/`findPaths` correctness on a small hand-built graph,
independent of any builder). Unit tests for the Module Graph builder and Symbol Graph builder
against the fixtures. An end-to-end test (Phase 1/2's pattern) running real discovery → real parsing
→ real graph-building through `AnalyzerClient`, with a real `Analyzer` reading
`context.graphs.moduleGraph`/`.symbolGraph`.

## Acceptance criteria

- [x] `Graph` implemented in `@code-analyzer/graph` (`in-memory-graph.ts`), unit-tested independent
      of any builder (`tests/graph/in-memory-graph.test.ts`, 7 tests: add/lookup, invalid-edge
      rejection, `neighbors`/`query` filtering, `findPaths` shortest-path + `maxDepth` + cycle
      handling + disconnected/missing nodes).
- [x] Module Graph builder (`module-graph.ts`) produces correct `IMPORTS` edges for resolvable
      relative imports — including extensionless, ESM-style `.js`-pointing-at-`.ts`, and
      directory/`index.*` resolution — and correctly produces no edge for bare (`"left-pad"`) or
      unresolvable relative (`"./does-not-exist.js"`) specifiers (`tests/graph/builders.test.ts`).
- [x] Symbol Graph builder (`symbol-graph.ts`) produces correct `DECLARES`/`EXTENDS`/`IMPLEMENTS`
      edges against `fixtures/parser/basic-constructs/shapes.ts` (reused rather than duplicated).
- [x] A real graph-building `ProjectIndexer` (`graphProjectIndexer`, `packages/graph/src/
      project-indexer.ts` — composes `parserProjectIndexer` then builds both graphs) is wired into
      `AnalyzerClient.graphs`, exercised by an end-to-end test
      (`tests/graph/end-to-end.test.ts`) using real Phase 1+2 output, with a real `Analyzer`
      (`quality/module-import-fanout`) reading `context.graphs.moduleGraph`.
- [x] `pnpm build`, `pnpm typecheck`, `pnpm test` (62/62 after review-round fixes), `pnpm lint` all pass clean across the
      workspace.
- [x] `docs/project-status.md` updated to move this task from "next approved" to "completed".
- [ ] Human review before Phase 4 (Call Graph) is drafted for approval.
