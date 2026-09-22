# ADR-0014: Taint Graph `EdgeRelationType` Addition and `DataFlow[]` Placement

## Status

Accepted (2026-09-22, amit13091992@gmail.com).

## Context

Phase 5 (Taint Graph, human go-ahead recorded 2026-09-21 per `docs/project-status.md`) needs to
reconstruct source-to-sink `DataFlow` paths by walking the Call Graph (Phase 4). Its scoping doc
(`docs/tasks/phase-5-taint-graph.md`) deliberately left two questions open and gated them behind an
ADR before implementation:

1. Does `EdgeRelationType` (`packages/core/src/graph/graph.ts`) need a new value for a taint-flow
   step, or can Phase 5 reuse the existing `"CALLS"` value?
2. Where do reconstructed `DataFlow[]` (`packages/core/src/domain/data-flow.ts`) live — derived
   on-demand by analyzers walking `context.graphs.taintGraph`, or materialized into a new optional
   `AnalyzerContext.dataFlows?: readonly DataFlow[]` field?

Both are Section 37C frozen-contract changes (`EdgeRelationType` is explicitly called out in
`CLAUDE.md`: "extend `EdgeRelationType`... only via ADR"; `AnalyzerContext` fields are the same
class of change ADR-0010's `coverage?` field went through). Neither is authorized to change without
this ADR.

### Consumers inspected (Section 46)

Grepped `EdgeRelationType`, every literal member of that union, and `callGraph` across
`packages/*/src` at drafting time (2026-09-22):

- **`EdgeRelationType` type consumers** (import/reference the type itself, not a literal value):
  - `packages/core/src/graph/graph.ts:10` — the union declaration itself.
  - `packages/core/src/graph/graph.ts:36,46,62` — `GraphEdge.type`, `GraphQuery.edgeType`,
    `Graph.neighbors(id, edgeType?)`, all typed against the union, none exhaustively switching on
    it — adding a member is source-compatible for all three.
  - `packages/graph/src/in-memory-graph.ts:1,47` — `neighbors()` implementation, takes `edgeType`
    as an opaque filter value (`edge.type === edgeType`), no switch.
  - `packages/graph/src/node-ids.ts:1,24` — `edgeId(type, from, to)` template-literal ID builder,
    treats `type` as an opaque string, no switch.
  - `packages/graph/src/call-graph.ts` — the only builder importing `EdgeCertainty` (not
    `EdgeRelationType` by name) but constructing edges with a hardcoded `"CALLS"` literal
    (`node-ids.ts` `edgeId("CALLS", ...)`, `call-graph.ts:57,59`); does not read/branch on
    `EdgeRelationType` values from data, only writes one fixed literal.
  - `packages/graph/src/module-graph.ts`, `packages/graph/src/symbol-graph.ts` — same pattern:
    each builder hardcodes its own fixed literal(s) (`"IMPORTS"`/`"EXPORTS"`, `"DECLARES"`/
    `"REFERENCES"`/`"EXTENDS"`/`"IMPLEMENTS"`), never branches on the union as data.
- **Literal-value consumers** (code that matches a specific `EdgeRelationType` string as a
  read-side query filter): `packages/analyzers/src/circular-import.ts:62`
  (`edgeType: "IMPORTS"`), `packages/analyzers/src/unused-export.ts:79`
  (`edgeType: "IMPORTS"`). Both use the value to *filter* a `graph.query()` call for one specific
  relation; neither contains a `switch`/exhaustiveness check over the full union. Re-grepped
  `\.type ===` combined with "edge" and found no hits beyond the above — confirms the scoping doc's
  claim ("no consumer switches exhaustively") holds as of this drafting, not merely assumed stale.
- **`packages/analyzers/src/quality/lint-style-rules.ts`, `packages/analyzers/src/relative-specifier.ts`**
  — matched the broader grep for relation-name substrings but neither imports/uses
  `EdgeRelationType` or a graph at all (false-positive matches on unrelated identifiers); no change
  needed.
- **`context.graphs.callGraph` consumers**: `packages/graph/src/project-indexer.ts:27,34,35,40`
  builds and attaches `callGraph` to `AnalyzerContext.graphs`. Grepping
  `packages/analyzers/src/*.ts` and `packages/analyzers/src/**/*.ts` for `callGraph` /
  `graphs.callGraph` returns **zero matches** — no analyzer reads `context.graphs.callGraph` today.
  Phase 4 wired the field but no consumer exists yet (the first `security/*` rule, gated on Phase
  5, will be the first real reader). There is therefore no existing precedent of a materialized
  `CallPath[]`-shaped collection sitting alongside `callGraph` in `AnalyzerContext` — Phase 4 chose
  "graph only, no derived collection," but that choice has not yet been exercised by a real
  consumer, which this ADR treats as weak precedent, not none.

## Decision

### 1. `EdgeRelationType` gains one new value: `"FLOWS_TO"`

Add `"FLOWS_TO"` to the union in `packages/core/src/graph/graph.ts`:

```ts
export type EdgeRelationType =
  | "IMPORTS"
  | "EXPORTS"
  | "DECLARES"
  | "REFERENCES"
  | "CALLS"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "DEPENDS_ON"
  | "FLOWS_TO";
```

Rationale:

- A taint step is not a call. A `TaintStep` can exist at a point where no `CALLS` edge exists at
  all (e.g. a sanitization step is a transformation on a value, not an invocation relationship
  worth re-asserting as "calls"; a source read like `req.query.id` flowing into a local variable
  has no callee to point a `CALLS` edge at). Overloading `"CALLS"` to mean two different
  relationships ("A invokes B" vs. "tainted data reaches B") would make `graph.query({edgeType:
  "CALLS"})` ambiguous for every existing and future Call Graph consumer — a caller asking "what
  does this function call" would start getting taint-step edges back unless every call site added
  its own extra filtering, which is a worse contract than a second value.
- Every existing graph in this system (Module, Symbol, Call) already has its own dedicated
  relation type(s) rather than overloading another graph's; Taint Graph following that precedent
  (Section 35.12 read the other direction — extend the existing `EdgeRelationType` model with a new
  member of the same enum, rather than introduce a parallel edge-typing scheme) is more consistent
  than the one exception.
- The consumer inspection above confirms this is genuinely additive: no file switches
  exhaustively on `EdgeRelationType`, so a new union member requires zero changes to
  `in-memory-graph.ts`, `graph.ts`'s interfaces, or any existing builder
  (`module-graph.ts`/`symbol-graph.ts`/`call-graph.ts`). Exactly the files the scoping doc
  predicted need to change do: the union itself (`packages/core/src/graph/graph.ts`), and the new
  `packages/graph/src/taint-graph.ts` builder (uses `edgeId("FLOWS_TO", ...)` from the existing,
  unchanged `node-ids.ts` helper — `edgeId` takes `type: EdgeRelationType` opaquely, so
  `node-ids.ts` itself needs no edit). `packages/analyzers/src/circular-import.ts` and
  `unused-export.ts` are unaffected (they filter on `"IMPORTS"` only).

Alternative considered and rejected: reuse `"CALLS"` for taint-flow edges (Taint Graph as an
annotated read of the Call Graph, no new edge type). Rejected because it conflates two distinct
relationships under one label, breaks the "ask for CALLS, get calls" expectation every existing
Call Graph consumer (present and the yet-to-be-written `security/*` analyzers) can otherwise rely
on, and saves exactly one union member at the cost of a query-filtering burden pushed onto every
future caller instead. The one-time cost of a new enum member, already shown to be additive by the
consumer inspection, is cheaper than that recurring cost.

### 2. Reconstructed `DataFlow[]` are derived on demand; no new `AnalyzerContext` field

`buildTaintGraph` produces a `Graph` (`context.graphs.taintGraph`) whose `FLOWS_TO` edges and node
`data`/`metadata` carry enough information (source/sink/sanitizer kind, `CallSite`/parameter
identity, `EdgeCertainty`) to reconstruct `TaintNode`/`TaintStep`/`DataFlow` shapes at read time.
Security analyzers (`packages/analyzers/src/security/*`, the next task) call a shared
reconstruction helper (living in `packages/graph`, e.g. exported alongside `buildTaintGraph`, not a
new core contract) that walks `taintGraph.findPaths`/`query` and returns `DataFlow[]` — the same
way `graph.query`/`findPaths` are already the read pattern for `IMPORTS`/`CALLS` consumers today.
**No new `AnalyzerContext.dataFlows?` field is introduced.**

Rationale:

- Precedent, weighed honestly: Phase 4's `callGraph` field has zero consumers today (confirmed by
  the grep above), so there is no live example of "a graph field plus a separately materialized
  path collection" pattern actually paying for itself in this codebase yet. The only existing
  precedent for a *derived, read-time* collection over graph data is the documented intent behind
  `Graph.findPaths`/`query` themselves — that is what they exist for. Introducing
  `context.dataFlows?` now would be inventing a second pattern (materialize-in-context) alongside
  the first (query-the-graph) with only a hypothetical consumer, which is exactly the "parallel
  abstraction" Section 35.12 asks to avoid, and exactly the "don't build ahead of a genuine need"
  Section 35.13 asks to avoid — no consumer has asked for a pre-materialized `DataFlow[]`; the
  as-yet-unwritten `security/*` rule is free to call a graph-side reconstruction function directly.
- A materialized `AnalyzerContext.dataFlows?` field would itself be a second Section 37C contract
  change stacked on top of the `EdgeRelationType` addition, needing its own consumer inspection and
  ADR reasoning distinct from this one (per Section 43/46) — avoiding it keeps this ADR's contract
  surface to exactly the one addition Phase 5 structurally requires (a new edge relation to
  represent), not two.
- If a second real consumer of `DataFlow[]` emerges later (e.g. a coverage-correlation analyzer per
  ADR-0010 §4's "coverage-taint correlation" line, or a reporting exporter that wants
  path-level data independent of any single `Finding`) and re-deriving from `taintGraph` on every
  call becomes a measured performance problem, that is a future ADR grounded in an actual second
  consumer and a profiled cost — not decided speculatively here (Section 4: profile before adding
  complexity).
- This keeps `packages/core` minimal (dependency policy) — no new field, no new derived-collection
  contract, only the one enum member the Taint Graph structurally cannot exist without.

### 3. No other core contract changes

`DataFlow`, `TaintNode`, `TaintStep`, `TaintSourceKind`, `TaintSinkKind`
(`packages/core/src/domain/data-flow.ts`) are unchanged — they already exist from Phase 0 and this
ADR does not touch their shape. `AnalyzerContext.graphs.taintGraph` (`packages/core/src/analyzer/
context.ts:19`) is unchanged — already an optional `Graph` field since Phase 0, additive, no ADR
required for wiring it (per the scoping doc's own finding, restated here for completeness only).

## Alternatives Considered

- **Reuse `"CALLS"` for taint steps.** Rejected — see Decision §1.
- **A generic `"RELATES_TO"` catch-all edge type usable by any future graph** instead of a
  taint-specific `"FLOWS_TO"`. Rejected: premature unification (Section 35.12) with only one real
  consumer (Taint Graph); every other graph in this system names its relations by what they
  concretely mean (`CALLS`, `IMPORTS`, `EXTENDS`), and a generic label would need a second field
  (e.g. `data.flowKind`) to recover the specificity a dedicated enum member already gives for free,
  losing type-level exhaustiveness-checking value for no benefit.
- **Materialize `DataFlow[]` into `AnalyzerContext.dataFlows?`.** Rejected for now — see Decision
  §2. Revisit only with a real second consumer or a measured re-derivation cost.
- **Materialize `DataFlow[]` inside `ProjectModel` instead of `AnalyzerContext`.** Rejected without
  extended discussion: `ProjectModel` is the static, pre-graph representation of the repository
  (Section 2's pipeline order places it before any graph exists); `DataFlow` is graph-derived
  analysis output, not project structure, so it belongs no earlier in the pipeline than
  `AnalyzerContext` at best, and per §2 above, not even there yet.

## Consequences

- `packages/core/src/graph/graph.ts`: one new `EdgeRelationType` union member (`"FLOWS_TO"`). No
  other change to `GraphEdge`, `GraphQuery`, or `Graph`.
- No change to `packages/core/src/analyzer/context.ts`, `packages/core/src/domain/data-flow.ts`, or
  any other core file.
- `packages/graph/src/taint-graph.ts` (new, next task) is the only builder expected to construct
  `FLOWS_TO` edges; no existing builder (`module-graph.ts`, `symbol-graph.ts`, `call-graph.ts`)
  needs to change. `packages/graph/src/node-ids.ts`'s `edgeId()` helper needs no change (already
  generic over `EdgeRelationType`).
- No existing analyzer (`circular-import.ts`, `unused-export.ts`, `quality/*`, `secrets/*`) needs
  to change — none reads `EdgeRelationType` exhaustively or reads `taintGraph`/`callGraph` today.
- The first `security/*` analyzer (next task, gated on this ADR being accepted and on Section 47's
  own review path) will need a `DataFlow[]`-reconstruction helper alongside `buildTaintGraph` in
  `packages/graph` — that helper's exact signature is implementation detail for that task, not
  frozen here, but its existence (rather than a `context.dataFlows?` field) is what this ADR
  commits to.
- Nothing in this ADR authorizes starting implementation by itself — Phase 5's own checklist still
  requires the fixed source/sink/sanitizer signature table (step 3), `buildTaintGraph` (step 4),
  fixtures/tests (steps 6–8), and green `pnpm build && pnpm typecheck && pnpm test` (step 9) before
  `docs/project-status.md` is updated, and that update itself requires human sign-off (Section 49),
  not an agent's unilateral call. This ADR being accepted only clears checklist steps 1–2.
</content>
