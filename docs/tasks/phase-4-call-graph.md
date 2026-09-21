# Task: Phase 4 — Call Graph (DRAFT — awaiting direct human confirmation to begin implementation)

## Objective

Implement a **Call Graph** builder in `@code-analyzer/graph`: `CALLS` edges from a call site
(a function/method body) to the declaration(s) it invokes, resolved as far as static analysis
honestly allows and marked with the correct `EdgeCertainty` everywhere it doesn't.

## What's already available to build on

- **Symbol Graph (Phase 3)**: `DECLARES` edges already tell us where every function/method/class in
  the project is declared (`packages/graph/src/symbol-graph.ts`). The Call Graph does not need to
  re-derive declarations — it needs to resolve *call sites* (which Phase 2's parser does not
  currently emit as first-class data — see Dependencies below) against those existing declaration
  nodes.
- **Module Graph (Phase 3)**: resolves cross-file `import`/`require` specifiers to modules — needed
  so a call to an imported function can be traced to the module that declares it before the Symbol
  Graph's `DECLARES` edge finds the exact symbol node.
- **`EdgeRelationType: "CALLS"` and `EdgeCertainty: "direct" | "resolved" | "inferred" | "dynamic" |
  "unknown"`**: both already exist in `packages/core/src/graph/graph.ts`, defined in Phase 0,
  unused by any builder until now. See "Interface changes" below — no change needed.
- **`InMemoryGraph`**: the concrete `Graph` (ADR-0003) is relationship-agnostic; a `CALLS` edge is
  added the same way an `IMPORTS`/`DECLARES` edge is. No new graph primitive required.

## Dependency this phase actually needs first (parser-side)

Phase 2's `parseFile` records declarations (`FunctionEntity`, `ClassEntity`, `Symbol`) but does
**not** currently record call-site occurrences (`foo()`, `obj.method()`, `new Foo()`) anywhere in
`Module`. Building a Call Graph needs that data. This is the same situation Phase 3 flagged for
`REFERENCES` edges (identifier occurrences) and deliberately did not build speculatively. Call-site
extraction is a small, focused addition to `packages/parser` (walk each function/method body,
record call expressions with callee shape + argument shape), not a Phase 4 "graph" change — it
should land as its own reviewable step before or at the start of this phase's implementation, the
same way ADR-0008's diagnostics channel was called out as a separate prerequisite inside a phase
task doc rather than silently bundled in.

## What's genuinely hard here (must be represented honestly, not guessed)

Per ADR-0004 ("uncertainty representable, never hidden"), the following call shapes must resolve to
`EdgeCertainty: "dynamic"` or `"unknown"` rather than a confident guess:

- **Static, unambiguous same-file or cross-file calls** (`import { foo } from "./x"; foo()`,
  `this.method()` inside the declaring class, `new Foo()` where `Foo` resolves via the Module/Symbol
  Graph) → `"direct"` or `"resolved"`.
- **Dynamic property/computed dispatch** (`obj[methodName]()`, `obj["method"]()` where the string
  isn't a literal) → callee identity isn't known without value-flow analysis Phase 4 doesn't have →
  `"dynamic"`.
- **Higher-order functions / callbacks passed as arguments** (`array.map(fn)`, `emitter.on("x", fn)`)
  → the call site the callback eventually gets invoked from lives outside this project's AST (or
  requires data-flow tracking not in scope) → `"unknown"`, not silently dropped and not guessed as
  `"resolved"`.
- **`.call()` / `.apply()` / `.bind()`** → the real target is the object before `.call`, but binding
  and partial application make the target ambiguous when the receiver itself isn't statically known
  → `"resolved"` only when the pre-`.call`/`.apply`/`.bind` expression is itself a statically
  resolvable direct reference (e.g. `foo.call(this)` where `foo` is an imported function); otherwise
  `"dynamic"`.
- **Class inheritance method resolution** (a call to `this.method()` where `method` is only defined
  on a superclass, or overridden in a subclass reachable only at runtime via polymorphism) →
  Phase 3's same-file-only `EXTENDS` resolution means cross-file inheritance chains are already an
  acknowledged gap (see `docs/project-status.md`'s technical debt list); a call resolved only through
  a cross-file `extends` chain is `"inferred"` at best, and `"unknown"` where the chain itself isn't
  resolvable.
- Under no circumstances does the builder emit a `"resolved"`/`"direct"` `CALLS` edge based on name
  matching alone (e.g. "there's only one function named `handler` in the project, so it must be
  that one") — that is a guess wearing a confidence label, exactly what ADR-0004 prohibits.

## Non-goals

- **Cross-language calls** (e.g. JS calling into a Python subprocess, or vice versa) — no such
  linkage is modeled anywhere in `ProjectModel` yet (no IPC/subprocess/FFI domain concept); out of
  scope entirely, not just this phase.
- **Python Call Graph — deferred, not in Phase 4 scope.** Python has Symbol Graph support
  (ADR-0009) but the Module Graph still doesn't resolve Python imports (confirmed empirically, see
  `docs/project-status.md` technical debt), and Python call-site extraction doesn't exist in the
  Tree-sitter-based parser yet either. Building a Call Graph over declarations that can't yet be
  linked across files would produce a graph with no cross-module edges — not a useful deliverable,
  and it would silently understate Python coverage the way the Module Graph gap already does.
  JS/TS-only for Phase 4; Python Call Graph is a follow-up once Python Module Graph resolution lands
  (tracked as existing technical debt, not new).
- **`REFERENCES` edges** — still not built; call-site extraction (see Dependencies above) is a
  narrower, purpose-built addition for `CALLS` specifically, not a general identifier-occurrence
  walk. If a future need arises for non-call references, that's its own task, same as Phase 3 said.
- **Taint Graph** (Phase 5) — depends on Call Graph but is not part of it.
- **Interprocedural data-flow / points-to analysis** to make dynamic dispatch more precise — out of
  scope; Phase 4 represents uncertainty honestly rather than reducing it algorithmically. Revisit
  only if a concrete analyzer need justifies the complexity (Section 4's "profile before adding
  complexity").
- **Call Graph persistence/serialization for incremental analysis** (Section 29) — same deferral as
  Module/Symbol Graph in Phase 3.
- **Resolving calls into `node_modules`/external packages** — consistent with the Module Graph's
  existing non-goal; a call into an external package produces no edge (there's no project-internal
  node to point at), not a placeholder "external" node.

## Dependencies

- Phase 3 (Module Graph, Symbol Graph) — complete.
- A small, separate, reviewable parser-side addition: call-site extraction in
  `packages/parser` (JS/TS only). Land and test this first (or as step 1 of this task), the same way
  Phase 3 required Phase 2's `ImportBinding`s to already exist.

## Files / packages affected

- `packages/parser/src/**`: new call-site extraction (likely a new field on `Module` or
  `FunctionEntity`/`ClassEntity`'s method entries — exact shape to be decided during implementation,
  extending the existing domain model per Section 35.12 rather than introducing a parallel one).
- `packages/graph/src/call-graph.ts` (new): the builder itself.
- `packages/graph/src/project-indexer.ts`: extend `graphProjectIndexer` to also build the Call Graph
  and populate `AnalyzerContext.graphs.callGraph`.
- `packages/core/src/analyzer/context.ts`: confirm `AnalyzerContext.graphs` already has room for a
  `callGraph` key (check before assuming — if it's a fixed shape rather than an open record, adding
  a key is itself a Section 37C contract change requiring an ADR; verify during implementation kickoff,
  not assumed here).

## Interface changes

**None expected in `packages/core`.** `Graph`, `EdgeRelationType` (`"CALLS"` already present), and
`EdgeCertainty` (`"direct" | "resolved" | "inferred" | "dynamic" | "unknown"` already present) were
all defined in Phase 0 with the Call Graph explicitly named in the doc comment
(`packages/core/src/graph/graph.ts` line 5: "the Module Graph, Dependency Graph, Symbol Graph, Call
Graph, and Taint Graph are all built on") and in the `EdgeCertainty` doc comment (line 21: "most
important for CALLS edges over dynamic JS/TS... Dynamic dispatch must be represented, never
silently dropped"). This phase is exactly the scope that comment was written for. **No new ADR is
needed for the graph contract itself**, following the same reasoning Phase 3 used for its own
"no new ADR" call.

If implementation determines `AnalyzerContext.graphs` needs a shape change to add `callGraph`
(rather than already being open for it), that specific change — and only that one — needs its own
ADR before landing, per Section 46 (inspect all consumers of `AnalyzerContext.graphs` across
`packages/*/src` first).

## Implementation checklist

1. Verify `AnalyzerContext.graphs`'s exact shape (`packages/core/src/analyzer/context.ts`) and confirm
   whether adding `callGraph` is additive-only or needs an ADR. Grep all consumers first.
2. Design and land call-site extraction in `packages/parser` (JS/TS only) as its own reviewable
   step: record callee expression shape (identifier, member access, computed member access, `new`,
   `.call`/`.apply`/`.bind`) and argument list shape per call, with tests.
3. Implement `buildCallGraph` in `packages/graph/src/call-graph.ts`:
   - One `GraphNode` per callable (reuse Symbol Graph's function/method/class nodes rather than
     creating parallel ones — Section 35.12).
   - Resolve each call site against Module Graph + Symbol Graph declarations where statically
     unambiguous → `"direct"`/`"resolved"` `CALLS` edges.
   - Explicitly classify and emit `"dynamic"` or `"unknown"` edges for every case listed above,
     never silently drop a call site that can't be resolved.
4. Wire into `graphProjectIndexer` (`packages/graph/src/project-indexer.ts`).
5. Fixtures under `fixtures/graph/call-links/`: direct calls (same-file, cross-file via import),
   computed/dynamic dispatch, `.call`/`.apply`/`.bind`, a callback-passed-as-argument case, a
   cross-file inheritance case (documenting it resolves no better than `"inferred"`/`"unknown"`
   given Phase 3's same-file `EXTENDS` limitation).
6. Unit tests for `buildCallGraph` per fixture category, asserting both the edge's existence *and*
   its `EdgeCertainty` value — an edge with the wrong certainty is as wrong as a missing edge.
7. End-to-end test through `AnalyzerClient` with a real `Analyzer` reading
   `context.graphs.callGraph`.
8. `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint` clean across the workspace.
9. Update `docs/project-status.md` to move this task from "next approved"/"in progress" to
   "completed" — only after implementation is actually done, not at planning time.

## Acceptance criteria

- [ ] Call-site extraction lands in `packages/parser` with its own tests, reviewed as a discrete
      change.
- [ ] `buildCallGraph` produces correct `CALLS` edges with correct `EdgeCertainty` for: direct
      same-file calls, direct cross-file calls (via Module Graph resolution), computed/dynamic
      dispatch, `.call`/`.apply`/`.bind` forms, callbacks-as-arguments, and cross-file-inheritance
      method calls.
- [ ] No call site is ever silently dropped — every call expression the parser records produces
      exactly one `CALLS` edge (possibly `"unknown"`/`"dynamic"`) or is documented as an explicit
      non-goal (e.g. calls into `node_modules`).
- [ ] `graphProjectIndexer` populates `AnalyzerContext.graphs.callGraph`.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint` all pass clean.
- [ ] `docs/project-status.md` updated to reflect actual completion state.
- [ ] Human review before Phase 5 (Taint Graph) is drafted for approval.
</content>
