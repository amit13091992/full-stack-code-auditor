# ADR-0010: Package Placement and Contracts for Security, Code Quality, and Test Coverage Subsystems

## Status

Accepted (2026-09-18, amit13091992@gmail.com). Track A (coverage ingestion) and Track B1 (quality
analyzers needing only Phase 2/3 data) in `docs/tasks/security-quality-coverage-modules.md` may now
proceed per ADR-0010 §4 — they do not require Phase 4/5. Track B2, Track C, and Track D remain
blocked on Phase 4/5 landing, unchanged.

## Context

The CTO asked for three roadmap capabilities to be designed at the architecture level: (1) SAST-style
security vulnerability scanning, (2) code quality analysis (complexity, duplication, maintainability,
lint-style rules, architectural smells), and (3) test coverage ingestion and correlation with the
graph (e.g. flagging untested code that reaches a risky sink).

Constraints already fixed by prior decisions:

- `docs/security/overview.md` already specifies the Security Engine's shape — `DataFlow`/`TaintNode`/
  `TaintStep`, `Evidence.kind: "data-flow-path"`, `Finding.cwe`/`.owasp` — and explicitly gates any
  concrete vulnerability rule (SQLi, XSS, SSRF, IDOR, etc.) on the taint engine (`packages/graph`,
  Phase 5) existing first. This ADR does not redesign that; it only decides where the rule
  implementations live and confirms nothing here relaxes the Phase 5 gate.
- `docs/architecture/overview.md`'s pipeline puts Call Graph at Phase 4 and Data-Flow/Taint Graph at
  Phase 5. Phase 3 (Module Graph, Symbol Graph) is complete and awaiting human sign-off; Phase 4 has
  not been approved to start.
- `packages/analyzers` already holds three real analyzers (`architecture/circular-import`,
  `architecture/unresolved-import`, `quality/unused-export`) plus a `secrets` analyzer, all built
  only on Phase 2/3 data (Module Graph, `Symbol`/`ImportBinding`/`ExportBinding`), proving the
  `Analyzer` contract (`packages/core/src/analyzer/analyzer.ts`) already fits graph-based static
  rules without any new interface.
- `packages/integrations` is reserved (ADR-0007) for the *opposite* direction of `packages/cli`'s
  exporters: normalizing external tool output (CodeQL, Semgrep, OSV, Trivy, Gitleaks, SARIF) into
  this project's model, plus CI/CD adapters. It has no other content yet.
- Section 31 / `docs/security/overview.md`: scanned repository content is untrusted; this project's
  main process must never execute it. A coverage report (LCOV/Istanbul/coverage.py JSON) is produced
  by *running the test suite*, which is test/repo code execution — it must never happen inside
  code-analyzer's process.
- ADR-0004: uncertainty must be representable, never hidden — a file for which no coverage data
  exists at all must not collapse to the same representation as a file proven to have 0% coverage.

## Decision

### 1. Security analyzers: no new package, gated exactly as already documented

Concrete SAST rules (SQLi, XSS, SSRF, path traversal, IDOR, JWT handling, etc., Section 7's list)
live in `packages/analyzers/src/security/*`, implementing the existing `Analyzer` contract with
`capabilities.category: "security"` and `capabilities.requiresGraphs: ["callGraph", "taintGraph"]`.
No new package, no new core contract beyond what `docs/security/overview.md` already lists
(`DataFlow`/`TaintNode`/`TaintStep`, `Evidence.kind: "data-flow-path"`, `Finding.cwe`/`.owasp`).
This ADR makes no change to that document's Phase 5 gate — restated here only so the roadmap has one
place that says explicitly: **no security analyzer implementation work starts before Phase 5 lands**,
per Section 47's enhanced review path (implementation → unit tests → security fixtures → regression
tests → architecture review → security review), which itself presupposes real taint data to test
against.

### 2. Code quality analyzers: no new package, no new core domain type

Complexity, duplication, maintainability, lint-style rules, and architectural smells are ordinary
`Analyzer` implementations in `packages/analyzers/src/quality/*` (extending the category
`quality`/`architecture` already in `AnalyzerCategory` — `quality/unused-export` already
establishes this precedent) producing ordinary `Finding` + `Evidence` pairs. **No new
`QualityMetric`/`ComplexityModel` core domain type is introduced.** Rationale (Section 35.12,
avoid a parallel abstraction; Section 35.13, don't build ahead of need):

- Per-function/per-file numeric metrics (cyclomatic complexity, duplication ratio, maintainability
  index) are evidence *for* a finding, not a new kind of entity the rest of the pipeline needs to
  reason about independently — they fit in `Evidence.summary` plus, if a rule needs to report a raw
  number rather than only a paragraph, `Finding` already has room for that via its existing
  fields (`severity`/`confidence`) without a new numeric-metrics contract. If a future consumer
  (e.g. a trend dashboard) genuinely needs structured metric values independent of any single
  finding, that is a real future ADR, not a Phase 4-adjacent one — no consumer exists today.
  Reference precedent: `docs/decisions/ADR-0009-angular-vue-python-support.md`'s Alternatives
  section made the same call against a generic multi-language abstraction with one data point.
- Duplication detection needs cross-file AST/token comparison, not a new graph edge type or
  domain entity — it is an algorithm inside the analyzer, reading `ProjectModel`/parsed
  `Module`s already available since Phase 2.
- Architectural smells that reason about *call* relationships (e.g. god objects via fan-in/fan-out,
  cyclic call dependencies distinct from the import cycles `architecture/circular-import` already
  detects) need the Call Graph (Phase 4) and therefore declare
  `requiresGraphs: ["callGraph"]`; anything reasoning only about `IMPORTS`/`DECLARES` (already
  available) does not, and should not falsely declare a Phase 4 dependency it doesn't have — decide
  per rule, matching the precedent set in `docs/tasks/first-graph-analyzers.md`.

### 3. Test coverage: new core domain type, ingestion lives in `packages/integrations`, correlation lives in `packages/analyzers`

Test coverage is different from the other two: it is *external data about repository behavior*
(produced by running tests), not something derivable from static analysis of the repository content
alone. It needs a place to land that data and a way to say "we have no data for this file" without
that meaning "this file is untested."

- **New `packages/core/src/domain/coverage.ts`**: `CoverageModel`, `FileCoverage`,
  `CoverageStatus`. Sketch (exact field list is implementation detail for the future task, not
  frozen by this ADR beyond the shape below):

  ```ts
  export type CoverageStatus = "covered" | "uncovered" | "partially-covered" | "unknown";

  export interface LineCoverage {
    readonly line: number;
    readonly hits: number; // 0 means executed-zero-times; absence of the entry means "unknown"
  }

  export interface BranchCoverage {
    readonly line: number;
    readonly branchId: string;
    readonly taken: boolean;
  }

  export interface FileCoverage {
    readonly fileId: FileId;
    readonly status: CoverageStatus;
    readonly lines: readonly LineCoverage[];
    readonly branches: readonly BranchCoverage[];
    readonly sourceTool: string; // e.g. "lcov", "istanbul", "coverage.py"
    readonly collectedAt: string; // ISO timestamp of the report, not scan time
  }

  export interface CoverageModel {
    readonly files: readonly FileCoverage[];
    /**
     * Files present in ProjectModel with no matching entry in `files` are "unknown" coverage, not
     * "uncovered" — the caller must never synthesize an uncovered FileCoverage entry for a file
     * the report simply didn't mention (ADR-0004).
     */
  }
  ```

  A file absent from `CoverageModel.files` is `unknown`, never defaulted to `uncovered`/0% — the
  same discipline `ADR-0004` already established. This is the one place a genuinely new core
  contract is justified: nothing existing (`Finding`, `Evidence`, `Graph`) can represent "no data
  available" for a specific file/line without a dedicated status field, and every consumer
  (quality and future security correlation) needs the same shape.

- **`AnalyzerContext` gains an optional `coverage?: CoverageModel` field**
  (`packages/core/src/analyzer/context.ts`), alongside the existing optional `graphs`/`changedFiles`
  — optional because most scans (and all scans before this ADR's ingestion work lands) have no
  coverage report available, mirroring how individual `GraphAccess` fields are already optional for
  the same "not every phase's data exists in every run" reason.

- **Ingestion lives in `packages/integrations`** (`packages/integrations/src/coverage/*`), not
  `packages/analyzers` or `packages/core` — this is external-tool-output normalization, exactly
  ADR-0007's stated reason for the package's existence, just LCOV/Istanbul/coverage.py instead of
  CodeQL/Semgrep/SARIF. A parser reads a coverage report **file already produced on disk by the
  user's own CI pipeline or local test run** and turns it into a `CoverageModel`. **`code-analyzer`
  never invokes a test runner, never executes repository code, in-process or via a subprocess it
  spawns itself** — satisfying Section 31 the same way `packages/parser` satisfies it for source
  files (read and interpret text, never `eval`/`require`/execute it). If a future CLI convenience
  wants to *run* the user's test command to produce a coverage file, that is a sandboxed/opt-in
  feature analogous to DAST (Section 26/31) and is explicitly out of scope for this ADR and not
  designed here.

- **Correlation lives in `packages/analyzers/src/coverage/*`**, as ordinary `Analyzer`
  implementations reading `context.coverage` alongside `context.graphs`/`context.project` — e.g.
  "function reachable from an HTTP endpoint (Call Graph, Phase 4) with `status: "uncovered"`" or,
  once Phase 5 lands, "a taint sink reachable from an untrusted source (Taint Graph, Phase 5) that
  passes through a line with `status: "uncovered"` or `"unknown"`" — the latter is explicitly a
  Phase 5-dependent capability, not available from Phase 4 data alone. No new `Analyzer`-like
  interface is introduced; `capabilities.requiresGraphs` plus reading the new optional
  `context.coverage` field is sufficient.

### 4. Roadmap placement (restated, no phase-number invention)

- **Coverage ingestion** (`CoverageModel`, `packages/integrations` parser) has no dependency on
  Call Graph or Taint Graph — it is pure text-format parsing plus mapping report paths to
  `ProjectModel` `FileId`s. It **could** start as soon as it is scheduled, independent of Phase 4/5,
  the same way `first-graph-analyzers.md` was approved as a parallel quick win. It is still not
  self-approving — see the task doc and `docs/project-status.md`'s sign-off requirement.
- **Coverage-graph correlation without taint** (e.g. "this exported/endpoint-reachable function has
  zero coverage") needs the Call Graph — Phase 4.
- **Coverage-taint correlation** ("untested code reaching a risky sink") needs the Taint Graph —
  Phase 5, no earlier, matching Section 6/7's existing gate.
- **Quality analyzers that only need Module/Symbol Graph** (duplication, per-function complexity,
  maintainability index, most lint-style rules) have no new blocker beyond normal scheduling — they
  need nothing this ADR doesn't already say is available today (Phase 2/3 data).
- **Quality analyzers reasoning about call relationships** (god-object/high-coupling smells, dead
  code beyond the existing `unused-export` heuristic) need the Call Graph — Phase 4.
- **Security analyzers**: unchanged from `docs/security/overview.md` — gated on Phase 5.

## Alternatives Considered

- **New `packages/quality` and/or `packages/coverage` packages.** Rejected: Section 35.5 (avoid
  premature package fragmentation). `packages/analyzers` already hosts multiple categories
  (`architecture`, `quality`, `secrets`) differentiated by `AnalyzerCapabilities.category`, not by
  package boundary; a new package buys nothing but an extra `tsconfig` reference and dependency edge
  for code that has the same shape and consumers as what's already there. Revisit only if
  `packages/analyzers` becomes unwieldy enough to need internal splitting — not indicated by three
  new rule families.
- **Put coverage ingestion in `packages/analyzers` instead of `packages/integrations`.** Rejected:
  ingestion (external file -> internal model) is a different responsibility from analysis (internal
  model -> Finding), and `packages/integrations` already exists specifically for
  external-artifact-to-internal-model normalization (ADR-0007). Keeping ingestion there and
  correlation in `packages/analyzers` mirrors the existing project-model/parser vs. analyzers split.
- **Represent "unknown coverage" as `Finding`/`Evidence` metadata instead of a new domain type.**
  Rejected: coverage is queried by potentially many analyzers (quality, and later security) as
  *input*, not asserted as a conclusion — it isn't a finding in itself, so it doesn't belong in the
  `Finding`/`Evidence` shape. A shared `AnalyzerContext.coverage` field is the same pattern already
  used for `graphs`.
- **Default missing coverage entries to `"uncovered"` for simplicity.** Rejected outright: violates
  ADR-0004 directly — a file the coverage tool never ran over (e.g. excluded by its own config) is
  not evidence of untested code; collapsing "no data" into "0% covered" would fabricate a finding
  category (files-with-suspiciously-perfect-exclusion-configs) is undetectable if this distinction
  is thrown away.
- **A generic `ExternalMetric` domain type covering quality metrics, coverage, and future
  vulnerability-scanner output uniformly.** Rejected: premature unification (Section 35.12) — the
  three have different uncertainty semantics (coverage's "unknown" is meaningfully different from a
  quality metric simply not being computed) and different consumers; a shared type would need
  enough optional fields to lose the type-safety benefit `exactOptionalPropertyTypes` is meant to
  give. Revisit only with a second real consumer that needs the unification, not speculatively.

## Consequences

- `packages/core` gains one new file (`domain/coverage.ts`) and one new optional field on
  `AnalyzerContext` — both additive, non-breaking to every existing consumer (`grep` across
  `packages/*/src` confirms `AnalyzerContext` is currently only read via destructuring/property
  access in `packages/analyzers/src/{secrets/secrets-analyzer,unresolved-import,circular-import,
  unused-export}.ts`, `packages/graph/src/project-indexer.ts`, and `packages/parser/src/
  project-indexer.ts`, none of which enumerate its keys exhaustively or would be broken by one more
  optional field). No consumer needs to change for this ADR to be accepted; consumers change only
  when they choose to read the new field.
- `packages/integrations` gets its first real content (still empty today).
- No change to `EdgeRelationType`, `Graph`, `Analyzer`, `Finding`, or `Evidence` — none of Section
  37C's frozen contracts are touched, beyond the additive `AnalyzerContext.coverage?` field, which
  is itself listed there and is why this ADR exists per Section 46.
- Security analyzer roadmap is unchanged from `docs/security/overview.md`; this ADR adds no new
  security surface and does not relax the Phase 5 gate.
- This ADR does not authorize starting implementation. See
  `docs/tasks/security-quality-coverage-modules.md` for the phased checklist and
  `docs/project-status.md` for the sign-off this still requires before any item begins. No file
  listed in this ADR's Decision section should be created until (a) this ADR is accepted and (b)
  the relevant phase gate in the linked task doc is reached.
