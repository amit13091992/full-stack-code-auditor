# Task: First Module-Graph Analyzers (quick win, parallel to Phase 4 scoping)

## Objective

Give `@code-analyzer/analyzers` its first real, non-empty content — three `Analyzer` implementations
that detect real issues using only what Phase 3 already built (`AnalyzerContext.graphs.moduleGraph`),
with no dependency on the Call Graph (Phase 4, still awaiting approval). This is explicitly smaller
and separate from Phase 4 — approved as a parallel quick win, not a substitute for it.

## Why these three, and why they don't need Phase 4

Analyzers reasoning about *execution* (data/taint flow between functions, function-level
reachability/dead-code) need `CALLS`/`REFERENCES` edges, which don't exist until Phase 4. These
three analyzers only reason about `IMPORTS` edges (Module Graph, Phase 3) and `ImportBinding`/
`ExportBinding` data already on `Module` (Phase 2) — no new graph, no core contract change, no ADR.

## Scope

Three analyzers in `packages/analyzers/src/`, category `"architecture"` (or `"quality"` for the
unused-export case — decide per rule, don't force one category), each `requiresGraphs: ["moduleGraph"]`:

1. **`architecture/circular-import`** (`circular-import.ts`): detect import cycles. For each module
   node in the Module Graph, use `Graph.findPaths` (already implemented, already bounded — see
   `packages/graph/src/in-memory-graph.ts`) or a direct cycle-detection walk over `IMPORTS` edges to
   find a module that imports itself transitively. Report each *distinct* cycle once (not once per
   participating module) — dedupe by the sorted set of module IDs in the cycle. `severity`
   should reflect this is a maintainability/architecture smell, not a security issue (e.g. `"low"`
   or `"medium"`, not `"critical"`).
2. **`architecture/unresolved-import`** (`unresolved-import.ts`): for every `ImportBinding` on every
   `Module`, check whether the Module Graph produced a corresponding `IMPORTS` edge. A relative
   specifier (`./`, `../`) with no resolved edge is a real problem (broken import, likely a typo or a
   file that was deleted/renamed) — flag it. A bare specifier (`"react"`, `"express"`, no `./`/`../`
   prefix) with no edge is expected (external package, Module Graph doesn't resolve `node_modules`
   per ADR-0005/Phase 3 non-goal) — do NOT flag it. Get this distinction right; it's the main
   false-positive risk for this rule.
3. **`quality/unused-export`** (`unused-export.ts`): a `Symbol`/`FunctionEntity`/`ClassEntity` with
   `exported: true` whose owning module has no incoming `IMPORTS` edge that plausibly references it.
   This is necessarily heuristic — the Module Graph resolves module-to-module edges, not which
   specific named export was imported, so this rule can only say "nothing in the project imports
   *this module* at all," not "nothing imports this specific export." Scope it accordingly:
   - Only flag when the *module* has zero incoming `IMPORTS` edges project-wide (not per-export).
   - Treat this as a real limitation, not swept under the rug: `description`/`title` text must say
     "no other module in this project imports `<module path>`," never claim "this export is
     unused" — that would overclaim precision the data doesn't support (ADR-0004).
   - Exclude likely entry points from this rule to control the obvious false-positive class: a
     module is skipped if its path matches a common entry-point pattern (`index.ts`/`index.js` at
     any directory level, or the file `package.json`'s own `"main"`/`"module"` field points to, once
     discovery data is available — check what's actually on `ProjectModel` before assuming; if
     `main`/`module` fields aren't captured on the model today, entry-point detection can be
     `index.*`-only for this task, and note the `package.json`-main gap as a known limitation rather
     than silently missing it).
   - `confidence` should be noticeably lower than the other two rules (this is the weakest signal of
     the three) — pick a value and justify it in a comment, don't default to something arbitrary.

## Evidence & Finding construction

Follow `.claude/skills/analyzer-development/SKILL.md` exactly: every `Finding` needs real `Evidence`
with an honest `SourceLocation` (the import statement's location for cycle/unresolved-import; the
export declaration's location for unused-export — Phase 2 already records these on `ImportBinding`/
`ExportBinding`/`Symbol`). `status` must be `"detected"` (static match only, nothing runtime-verified)
for all three — never `"confirmed"`.

## Fixtures & tests

Per `docs/testing/strategy.md` and the skill: one fixture directory per rule under
`fixtures/architecture/circular-import/`, `fixtures/architecture/unresolved-import/`,
`fixtures/quality/unused-export/`, each with a positive case and an explicit false-positive case
(e.g. unresolved-import's fixture must include a bare `"react"`-style import that should NOT fire).
Register all three with an `AnalyzerRegistry` instance (never wired directly into `packages/cli`,
per the skill) and add at least one real end-to-end test running them through `AnalyzerClient` with
real Phase 1-3 output (matching the pattern already established in `tests/graph/end-to-end.test.ts`).

## Non-goals

- Anything reasoning about which *specific* named export is used vs. only which module is imported
  — that needs `REFERENCES` edges (Phase 4+), explicitly out of scope here.
- Any Python coverage — Module Graph doesn't resolve Python imports yet (documented ADR-0009 gap);
  these three analyzers naturally produce nothing on Python modules but shouldn't special-case or
  crash on them either (`supports()` doesn't need to exclude Python — the underlying graph data
  simply won't have edges to reason about).
- Auto-fix / remediation actions beyond a `Remediation.summary` string — no code mutation.

## Validation

`pnpm typecheck` and `pnpm test` pass; each fixture's expected findings match actual output
(severity, confidence range, locations); each rule's false-positive fixture produces zero findings
from that analyzer.
