# Task: Security, Code Quality, and Test Coverage Subsystems (design + phased TODO)

Companion to `docs/decisions/ADR-0010-security-quality-coverage-subsystems.md` — read that first.
This doc is the tracker; the ADR is the decision record. Neither file authorizes implementation to
start — see `docs/project-status.md` for current phase and required sign-offs.

## Scope

Design and phase-plan three capabilities requested by the CTO:

1. Security vulnerability scanning (SAST-style), using the Call Graph (Phase 4) and Data-Flow/Taint
   Graph (Phase 5).
2. Code quality analysis: complexity, duplication, maintainability, lint-style rules, architectural
   smells.
3. Test coverage ingestion (LCOV/Istanbul/coverage.py-style reports) and correlation with the graph.

All three fit the existing `Analyzer` contract (`packages/core/src/analyzer/analyzer.ts`) and live in
`packages/analyzers` (correlation/rules) and, for coverage, `packages/integrations` (ingestion) per
ADR-0010. No new packages.

## Non-goals (for now)

- No implementation code in this task — no `packages/analyzers/src/security/*`,
  `packages/analyzers/src/quality/*`, `packages/analyzers/src/coverage/*`, or
  `packages/integrations/src/coverage/*` files. Design and contracts only.
- No `CoverageModel`/`AnalyzerContext.coverage` field created yet — ADR-0010 documents the intended
  shape; creating the actual file is a checklist item below, gated the same as everything else.
- No decision that Phase 4 or Phase 5 has started — that remains a human call recorded in
  `docs/project-status.md`, not implied by this doc existing.
- No CI-executed test-running feature (i.e. code-analyzer invoking the user's test command itself)
  — coverage ingestion only reads reports already produced by the user's own pipeline (Section 31).
  A sandboxed "run tests for me" feature, if ever wanted, is a separate, later, DAST-adjacent design.
- No secrets-detection redesign — `packages/analyzers/src/secrets/secrets-analyzer.ts` already exists
  and is out of scope here.
- No Architecture Rule DSL work (Section 16, already tracked as Phase 6+ in
  `docs/architecture/overview.md`).

## Checklist

### Immediately actionable (design/planning only — this task)

- [x] ADR-0010 drafted: package placement, `CoverageModel` shape, ingestion boundary, roadmap
      placement relative to Phase 4/5. (`docs/decisions/ADR-0010-security-quality-coverage-subsystems.md`)
- [x] This task doc.
- [x] `docs/architecture/overview.md` updated to reference both, without advancing "Current phase".
- [x] Human review/sign-off on ADR-0010 (amit13091992@gmail.com, 2026-09-18) — Track A and Track B1
      unblocked; Track B2/C/D remain blocked on Phase 4/5.

### Track A — Test coverage ingestion (independent of Phase 4/5 per ADR-0010 §4; still requires its own scheduling approval)

- [ ] Create `packages/core/src/domain/coverage.ts` (`CoverageModel`/`FileCoverage`/
      `CoverageStatus`/`LineCoverage`/`BranchCoverage`) per ADR-0010's sketch; export from
      `packages/core`'s public surface the same way other domain types are.
- [ ] Add optional `coverage?: CoverageModel` to `AnalyzerContext`
      (`packages/core/src/analyzer/context.ts`); confirm via `grep -r "AnalyzerContext" packages/*/src`
      (repeat the Section 46 consumer check at implementation time, not just at ADR time — the
      consumer list may have grown) that no existing consumer breaks.
- [ ] `packages/integrations/src/coverage/lcov.ts` — parse LCOV format into `CoverageModel`. State
      the dependency reason if a parsing library is used (dependency policy) vs. a small hand-rolled
      parser (LCOV's text format is simple; hand-rolled is worth evaluating first for
      `packages/core`-adjacent minimalism, though `integrations` isn't `core` itself).
- [ ] `packages/integrations/src/coverage/istanbul-json.ts` — parse Istanbul/`coverage-final.json`
      format into `CoverageModel`.
- [ ] `packages/integrations/src/coverage/coverage-py.ts` — parse coverage.py's JSON export format
      into `CoverageModel`.
- [ ] File-path-to-`FileId` mapping: coverage reports use their own path conventions (often relative
      to a different root than `ProjectModel`'s). Design + implement the mapping; a report entry that
      can't be mapped to a known `FileId` must be dropped with a `Diagnostic` (ADR-0008's channel),
      never silently coerced into a guess.
- [ ] Wire coverage ingestion into the CLI as an explicit opt-in input (e.g. a `--coverage <path>`
      flag on `scan`), never automatic/implicit test execution.
- [ ] Fixtures: one real LCOV/Istanbul/coverage.py report per format under
      `fixtures/coverage/<format>/`, including a case with a file the report doesn't mention (must
      surface as `"unknown"`, not `"uncovered"`) and a case with a report path that doesn't map to
      any `ProjectModel` file (must diagnostic, not crash).
- [ ] Tests: unit tests per parser, plus a real end-to-end test proving `AnalyzerContext.coverage`
      is populated through `AnalyzerClient.scan()`.

### Track B — Code quality analyzers

#### B1 — needs only Module/Symbol Graph (Phase 2/3, already built) — blocked only on Phase 4 scheduling discipline, not on Phase 4's graph itself

- [ ] `quality/cyclomatic-complexity` — per-function complexity from Phase 2's `FunctionEntity`
      data/AST; threshold-based finding, `category: "quality"`, no `requiresGraphs`.
- [ ] `quality/duplication` — cross-file structural/token duplication over parsed `Module`s;
      decide and document the comparison algorithm (e.g. normalized-AST hashing over N-line windows)
      before implementing — this is exactly the kind of contract worth one design note, not a full
      ADR (no Section 37C contract changes, so no ADR required, per ADR-0010 §2).
- [ ] `quality/maintainability-index` — composite of complexity + size + (optionally) duplication;
      decide the formula and cite the reference (e.g. the standard MI formula) before implementing.
- [ ] `quality/lint-style-rules` — decide which lint-style checks are genuinely architectural facts
      derivable from the existing model (e.g. "function exceeds N parameters", "file exceeds N
      lines") vs. which would just reimplement ESLint/a real linter badly — scope narrowly, don't
      build a general-purpose linter here (Section 35.13).
- [ ] Fixtures + tests per rule, following `docs/tasks/first-graph-analyzers.md`'s pattern
      (positive + false-positive case each).

#### B2 — needs Call Graph — blocked on Phase 4 landing

- [ ] `architecture/high-coupling` (god-object smell: fan-in/fan-out via `CALLS` edges) —
      design the threshold/metric once real Call Graph data exists to calibrate against; don't
      guess thresholds against synthetic data alone.
- [ ] `architecture/dead-code` (function-level, beyond the existing module-level
      `quality/unused-export` heuristic) — needs `CALLS`/`REFERENCES` edges.
- [ ] Revisit whether any B1 rule benefits from becoming call-graph-aware once Phase 4 data exists
      (e.g. duplication scoped to only reachable code) — not required, evaluate then.

### Track C — Security (SAST) analyzers — fully blocked on Phase 4 + Phase 5, per `docs/security/overview.md` (unchanged by this task)

- [ ] Re-confirm `docs/security/overview.md`'s contracts (`DataFlow`/`TaintNode`/`TaintStep`,
      `Evidence.kind: "data-flow-path"`, `Finding.cwe`/`.owasp`) are still sufficient once real
      Phase 5 taint data exists — do not add new fields speculatively before that data exists to
      validate the shape against.
- [ ] Injection rules (SQLi, command injection, NoSQL injection) — first candidates once taint graph
      lands, per Section 7's ordering (source/sink pairs most directly expressible with `TaintStep`).
- [ ] XSS / template-injection rules.
- [ ] SSRF / path traversal rules.
- [ ] Authn/authz rules — explicitly deferred further: `docs/security/overview.md` notes
      `AuthenticationModel`/`AuthorizationModel` are Phase 6+ scope (Section 8/9 full reasoning), so
      these wait even after Phase 5.
- [ ] Each rule: implementation → unit tests → security fixture tests → regression tests →
      architecture review → security review (Section 47), no shortcuts, starting from the first file.

### Track D — Coverage/graph correlation (spans Phase 4 and Phase 5 boundaries)

- [ ] `coverage/reachable-uncovered` (needs Call Graph, Phase 4; does not need Taint) — flags a
      function reachable from an entry point (HTTP endpoint, CLI command, exported public API) with
      `FileCoverage.status: "uncovered"` for the lines containing it. Design the "entry point"
      definition consistently with whatever Phase 4/`EndpointModel` work defines an entry point as
      — don't invent a second definition.
- [ ] `security/untested-sink-path` (needs Taint Graph, Phase 5) — flags a taint source-to-sink path
      (`DataFlow`) where any step's line has `status: "uncovered"` or `"unknown"`. This is the
      capability the CTO specifically asked for ("untested code paths that reach risky sinks”); it
      is correctly the last item on this list because it depends on everything above it.

## Validation (once any track begins)

Same bar as every other analyzer per `.claude/rules/testing.md` and the analyzer-development skill:
`pnpm typecheck`/`pnpm test` pass, every rule ships with positive + false-positive fixtures, every
`Finding` has real `Evidence` with an honest `SourceLocation`, `status` stays `"detected"` unless a
rule has a genuine basis for `"confirmed"`.
