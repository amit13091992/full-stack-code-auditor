# Task: Phase 5 — Taint Graph (DRAFT — NOT approved to start; awaiting explicit human go-ahead)

**Status of this document itself:** scoping only, per architect responsibility (Section 42/49). No
implementation, no `EdgeRelationType`/core contract change, no analyzer code has been written as
part of producing this doc. `docs/project-status.md` still lists Phase 5 as "not drafted" until a
human records a go-ahead there — this doc existing does not change that.

## Objective

Implement a **Taint Graph** in `@code-analyzer/graph`: source-to-sink data-flow reconstruction over
the existing Call Graph (Phase 4), Symbol Graph, and Module Graph, populating
`AnalyzerContext.graphs.taintGraph` and enabling the first `packages/analyzers/src/security/*`
rules that ADR-0010 explicitly gated on this phase. Per `docs/security/overview.md` and ADR-0010,
**no concrete SAST rule (SQLi, XSS, SSRF, path traversal, IDOR, etc.) starts implementation before
this phase lands**, and any taint-touching change follows the enhanced review path (Section 47):
implementation → unit tests → security fixtures → regression tests → architecture review → security
review — restated here, not redefined.

## What a Taint Graph is in this system's terms

A Taint Graph is not a new kind of node scheme parallel to the Call Graph's — it is a set of
`DataFlow` paths (already defined in `packages/core/src/domain/data-flow.ts` since Phase 0)
reconstructed by walking the Call Graph's `CALLS` edges from a **source** to a **sink**, with
**propagation/transformation/sanitization** steps in between.

- **Sources** (`TaintSourceKind`, already frozen in core): `http-request`, `query-parameter`,
  `route-parameter`, `request-body`, `header`, `cookie`, `file`, `environment-variable`,
  `deep-link`, `mobile-input`, `database-result`, `message-queue`, `external-api-response`. Phase 5
  needs to decide, for the JS/TS/Node-Express-first cut, which of these are actually
  *recognizable from parsed data today* — e.g. `process.env.X` (`environment-variable`),
  `req.query`/`req.params`/`req.body`/`req.headers`/`req.cookies` in an Express-style handler
  (`query-parameter`/`route-parameter`/`request-body`/`header`/`cookie`), `fs.readFile*` results
  (`file`). Kinds with no existing structural anchor in `ProjectModel`/parsed output
  (`deep-link`, `mobile-input`, `message-queue`, `external-api-response`, `database-result` without
  an ORM-call convention) are real gaps, not silently claimed — see Non-goals.
- **Sinks** (`TaintSinkKind`, already frozen in core): `sql`, `shell-command`, `filesystem`,
  `html-render`, `redirect`, `network-request`, `eval`, `deserialization`, `logging`,
  `database-operation`. Recognized the same way sources are: by matching `CallSite.calleeName`/
  `receiverText` shapes already recorded by the Phase 4 parser work (e.g. `eval(...)` →
  `calleeKind: "identifier"`, `calleeName: "eval"`; `child_process.exec(...)` → `member` call with
  `receiverText`/`calleeName` matching a known dangerous API; a template-engine `render(...)` call
  → `html-render`). This needs a **fixed, named list of recognized source/sink call signatures**
  (see Non-goals) — not a general points-to/taint-summary system for arbitrary third-party APIs.
- **Propagation**: taint flows from a source `FunctionEntity`/parameter into a sink by following
  `CALLS` edges already in the Call Graph — if a tainted value is passed as an argument at a call
  site, and the callee is reachable via a `"direct"`/`"resolved"` `CALLS` edge, taint is presumed to
  reach that callee's corresponding parameter. This is **argument-position propagation only** —
  Phase 5 does not do full value-flow/points-to analysis (see Non-goals); it reuses exactly the
  edges Phase 4 already computed, adding no new edge-resolution logic to the Call Graph itself.
- **What it builds on**: Call Graph (`CALLS` edges + their `EdgeCertainty`, Phase 4) is the primary
  substrate — a `DataFlow` path's `steps` are Call Graph traversal steps. Symbol Graph
  (`DECLARES`) is used to resolve which `FunctionEntity`/parameter a source/sink call site sits in.
  Module Graph is used only transitively, the same way Call Graph already used it for cross-file
  resolution — Phase 5 adds no new cross-file resolution algorithm of its own.
- **Sanitization**: a call to a known sanitizer (e.g. `escapeHtml`, `parseInt`, a parameterized SQL
  query builder call) recognized by the same fixed-list mechanism as sinks, marked as a
  `TaintStep.kind: "sanitization"` with `operation` set to the recognized name; `DataFlow.sanitized`
  becomes `true`. This is a named-function-recognition heuristic, not a real taint-clearing proof
  — `confidence` must reflect that (see Concrete deliverables).

## Concrete deliverables

1. **`buildTaintGraph` in `@code-analyzer/graph`** (`packages/graph/src/taint-graph.ts`, new),
   analogous in shape to `buildCallGraph`: takes `Module[]`/`FunctionEntity[]`/`ClassEntity[]` plus
   the already-built Call Graph, and produces a `Graph` whose edges represent taint-flow steps, plus
   (separately, see below) the actual reconstructed `DataFlow[]` for analyzers to consume.
2. **`EdgeRelationType` — does it need a new value?** Current union (`packages/core/src/graph/
   graph.ts`): `IMPORTS | EXPORTS | DECLARES | REFERENCES | CALLS | EXTENDS | IMPLEMENTS |
   DEPENDS_ON`. There is no `TAINT_FLOW`/`FLOWS_TO` value today. **This is a Section 37C frozen-enum
   contract change and requires an ADR before implementation**, per CLAUDE.md's explicit callout
   ("Add a graph relationship: extend `EdgeRelationType`... only via ADR"). The ADR must:
   - Name the new value (candidate: `"FLOWS_TO"`, to read naturally as "source flows to sink/step").
   - Inspect all consumers of `EdgeRelationType` across `packages/*/src` (today: `packages/graph`'s
     builders and `node-ids.ts`/`edgeId`, `packages/core`'s own type file, any analyzer pattern-
     matching on edge `type` — currently none do this exhaustively via a `switch`, confirmed by
     `grep` at drafting time; re-verify at implementation time, not assumed stale here) and list
     which files must change consistently (Section 46) — expected: `packages/graph/src/
     taint-graph.ts` (new), `packages/graph/src/node-ids.ts` (edge-id helper), and the
     `EdgeRelationType` union itself. No existing builder should need to change.
   - Alternative to evaluate in that ADR: reuse `"CALLS"` edges directly (Taint Graph as an
     annotated read of the existing Call Graph, no new edge type) versus a dedicated `"FLOWS_TO"`
     edge type per taint step. Recommendation to weigh: a dedicated edge type is more honest — a
     taint step is a different relationship than "calls," it can exist without a direct `CALLS`
     edge existing (e.g. a `TaintStep` at a sanitization point isn't itself a call), and every other
     graph in this system (Module/Symbol/Call) already has its own dedicated relation type(s) rather
     than overloading another graph's — but this is exactly the tradeoff the ADR needs to make
     explicit, not something this scoping doc pre-decides.
3. **`AnalyzerContext.graphs.taintGraph`**: already exists in `GraphAccess`
   (`packages/core/src/analyzer/context.ts:18`) as an optional `Graph` field, unused since Phase 0 —
   **additive, no ADR needed for this specific field** (mirrors Phase 4's finding that `callGraph`
   was already additive). Wiring it via `graphProjectIndexer` is the only change needed here.
4. **Where do reconstructed `DataFlow[]` live?** `DataFlow`/`TaintNode`/`TaintStep` already exist in
   `packages/core/src/domain/data-flow.ts`, but nothing in `AnalyzerContext`/`ProjectModel` holds a
   `DataFlow[]` collection today (unlike `Finding`/`Evidence`, which flow through
   `AnalysisResult`). Two options to resolve during implementation kickoff (not pre-decided here,
   flag for architect review at that point):
   - (a) `DataFlow[]` is derived on demand by security analyzers by walking `taintGraph` themselves
     (analyzers already do the equivalent for `CALLS`/`IMPORTS` via `graph.findPaths`/`query`) — no
     new `AnalyzerContext` field, `taintGraph`'s nodes/edges carry enough `data`/`metadata` to
     reconstruct `TaintNode`/`TaintStep` shapes at read time.
   - (b) `graphProjectIndexer` (or the Taint Graph builder itself) also returns a materialized
     `DataFlow[]`, requiring a new `AnalyzerContext` field (e.g. `dataFlows?: readonly DataFlow[]`)
     — itself a Section 37C-listed contract addition needing its own ADR (additive optional field,
     same class of change as ADR-0010's `coverage?` field, likely low-friction, but still requires
     the ADR per Section 43/46, and requires inspecting the same consumer list as ADR-0010 did).
   Recommendation to evaluate at kickoff: (a) is closer to how `callGraph` is actually consumed
   today (no separate `CallPath[]` collection exists; analyzers query the graph directly) and avoids
   a second core contract change stacked on top of the `EdgeRelationType` one — but this is a real
   decision, not assumed, and belongs in the same ADR as item 2 or a short companion ADR.
5. **First security `Analyzer`(s)**: e.g. `security/sql-injection` or
   `security/command-injection` in `packages/analyzers/src/security/*` (new subdirectory, existing
   package — no new package, per ADR-0010 §1/§Alternatives), `capabilities.category: "security"`,
   `capabilities.requiresGraphs: ["callGraph", "taintGraph"]`, producing `Finding` with
   `Evidence.kind: "data-flow-path"` and `Finding.cwe`/`.owasp` set. **This is implementation work
   gated on the enhanced security review path (Section 47) and is explicitly the next task after
   this one, not part of this scoping doc** — do not write rule logic while landing the graph itself.

## Package boundaries

- Graph builder: `packages/graph/src/taint-graph.ts`, following `buildCallGraph`'s existing pattern
  (reuse Symbol/Call Graph node ids, no parallel node scheme, Section 35.12).
- First security analyzer(s): `packages/analyzers/src/security/*`, an ordinary `Analyzer`
  differentiated by `capabilities.category: "security"` — consistent with how `architecture`/
  `quality`/`secrets` are just categories inside the same package (ADR-0010 §1/§2, §Alternatives
  rejecting a dedicated `packages/security`). No new package for either the graph builder (already
  lives in `packages/graph`) or the analyzer (already lives in `packages/analyzers`).
- No change to `packages/core` beyond the `EdgeRelationType` addition (pending its ADR) and,
  possibly, the `dataFlows?` field from deliverable 4(b) if that option is chosen (its own ADR).

## Known non-goals / deliberate scope cuts for a first cut

- **JS/TS only.** Same reasoning as Phase 4: Python has no Call Graph yet (Module Graph doesn't
  resolve Python imports either), so there is nothing to build a Taint Graph on top of for Python.
  Not a new gap — inherits Phase 3/4's existing one.
- **Same-file and Call-Graph-reachable cross-file flows only, bounded by Phase 4's existing
  `EdgeCertainty`.** A taint step through a `"dynamic"`/`"unknown"` `CALLS` edge is represented
  (per ADR-0004, uncertainty visible, not silently dropped) but with reduced `confidence` — Phase 5
  does not add new resolution power beyond what Phase 4 already computed; it consumes Phase 4's
  edges and their certainty as-is.
- **A fixed, small, named list of source/sink/sanitizer call signatures, not a full CWE catalogue
  or general taint-summary database.** Recognizing `req.query`, `eval`, `child_process.exec`,
  a couple of SQL-driver call shapes, and a couple of sanitizer names is a first cut; expanding the
  list is ordinary follow-up work per signature, not a redesign.
- **No interprocedural points-to/alias analysis.** Taint through argument position at a `CALLS` edge
  is tracked; taint through an object field written in one function and read in another, or through
  a closure-captured variable, is out of scope — represent as `"unknown"` if detected at all, do not
  guess.
- **No cross-language taint** (e.g. JS calling a Python subprocess) — same non-goal as Phase 4,
  restated: `ProjectModel` has no IPC/subprocess/FFI domain concept to link the two sides.
- **No `DataFlow` persistence for incremental analysis** (Section 29) — same deferral as every prior
  graph phase; design the builder so it *could* be made incremental later (deterministic node/edge
  IDs, no hidden global state), but don't build the caching layer now.
- **No concrete vulnerability rule content in this task.** This phase delivers the graph/contract;
  `security/*` rule logic is the next, separately reviewable task and goes through the full Section
  47 path independently.

## Fixture and test plan

- Fixtures under `fixtures/graph/taint-links/` (new), mirroring `fixtures/graph/call-links/`'s
  per-case structure:
  - A direct source→sink flow with no sanitization (e.g. `req.query.id` flowing unmodified into a
    SQL query call) — expect a `DataFlow` with `sanitized: false`.
  - The same flow with a recognized sanitizer call in between — expect `sanitized: true` and a
    `TaintStep.kind: "sanitization"` entry.
  - A flow that only resolves through a `"dynamic"`/`"unknown"` `CALLS` edge — expect the `DataFlow`
    to still be produced (not dropped) with visibly reduced `confidence`.
  - A false-positive case: a source value used only in a safe sink (e.g. logged, not passed to
    `eval`/SQL) — expect no `DataFlow` at all, proving the builder doesn't over-fire.
  - A case with no recognized source or sink at all — expect zero `DataFlow`s, zero taint-graph
    edges beyond whatever base Call Graph data still applies.
- Unit tests for `buildTaintGraph`/whatever taint-path-reconstruction function is chosen, asserting
  both structural shape (nodes/edges or `DataFlow[]`, depending on deliverable 4's resolution) and
  `confidence`/`sanitized` values per fixture, not just presence/absence.
- An end-to-end test through a real `AnalyzerClient` with a placeholder `Analyzer` reading
  `context.graphs.taintGraph` (or `context.dataFlows`, per deliverable 4) — same pattern as Phase
  3/4's end-to-end tests — proving the wiring works, independent of any real security rule.
- **Security fixtures and regression tests for the first real `security/*` rule are a separate,
  later step** (Section 47's own stage), not part of this phase's fixture set, though they will
  likely reuse `fixtures/graph/taint-links/`'s fixtures as a starting point.

## Implementation checklist

1. Write and land the `EdgeRelationType` ADR (candidate `"FLOWS_TO"` vs. reusing `"CALLS"`) —
   architect review required before any code lands, per Section 37C/46. Inspect all
   `EdgeRelationType` consumers across `packages/*/src` as part of that ADR, not assumed here.
2. Resolve deliverable 4 (where reconstructed `DataFlow[]` live) in the same ADR or a tightly-scoped
   companion ADR, before implementation starts.
3. Define the fixed source/sink/sanitizer call-signature list as a small, explicit, named table
   (e.g. `packages/graph/src/taint-signatures.ts`) — reviewable on its own, not buried inside the
   builder function.
4. Implement `buildTaintGraph` (or equivalent), consuming Call Graph + Symbol Graph + Module Graph
   data only, adding no new cross-file resolution logic of its own.
5. Wire into `graphProjectIndexer` to populate `AnalyzerContext.graphs.taintGraph`.
6. Fixtures under `fixtures/graph/taint-links/` per the Fixture plan above.
7. Unit tests asserting structural correctness and `confidence`/`sanitized` per fixture.
8. End-to-end test through `AnalyzerClient` with a placeholder `Analyzer` reading the new graph
   field.
9. `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint` clean across the workspace.
10. Update `docs/project-status.md` to move this task from "next approved"/"in progress" to
    "completed" — only after implementation is actually done and reviewed, and only by/with the
    human sign-off this file's own rule requires; an agent must not make that call unilaterally.
11. Only after step 10: the first real `packages/analyzers/src/security/*` rule is drafted as its
    own task, going through the full Section 47 review path (implementation → unit tests → security
    fixtures → regression tests → architecture review → security review) independently.

## Acceptance criteria

- [ ] ADR for the `EdgeRelationType` addition (and, if chosen, the `dataFlows?` context field)
      accepted before any implementation code lands.
- [ ] `buildTaintGraph` produces correct taint paths for: unsanitized direct flow, sanitized flow,
      flow through a `"dynamic"`/`"unknown"` Call Graph edge (reduced confidence, not dropped), a
      safe-sink false-positive case (no flow reported), and a no-source/no-sink case (nothing
      reported).
- [ ] `AnalyzerContext.graphs.taintGraph` is populated by `graphProjectIndexer`.
- [ ] No taint step is ever silently dropped where a recognized source/sink pair exists — reduced
      confidence, not omission, represents uncertainty (ADR-0004).
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint` all pass clean.
- [ ] `docs/project-status.md` updated to reflect actual completion state, only after human
      sign-off.
- [ ] Human review before any `security/*` rule implementation begins (Section 47's own gate, in
      addition to Phase 5's own architecture review).
</content>
