# Project Status

Machine- and human-readable status tracker (Section 49). Agents must read this before starting
substantial work and must not decide unilaterally that the project has advanced to the next phase —
that decision is made by a human and recorded here.

## Current phase

**Phase 0 — Foundation & Contracts**

## Current milestone

Phase 0 deliverable per Section 37: package architecture, domain model, TypeScript interfaces,
analyzer lifecycle, event model, error model, config model, serialization format, plugin model,
testing architecture, task specs, acceptance criteria.

## Completed components

- Monorepo scaffold: pnpm workspaces, `tsconfig.base.json`, 10 package boundaries created (`core`,
  `project-model`, `parser`, `graph`, `analyzers`, `engines`, `integrations`, `ai`, `plugins`, `cli`).
- `@code-analyzer/core` domain model: `Project`, `Repository`, `File`, `Module`, `Symbol`, `Function`,
  `Class`, `Dependency`, `Endpoint`, `DatabaseEntity`, `Service`, `SecurityBoundary`, `DataFlow`,
  `Evidence`, `Finding`, `Scan` — see `packages/core/src/domain/`.
- Core contracts: `Analyzer`, `AnalyzerContext`, `AnalysisResult`, `Graph`, `AnalyzerPlugin`,
  `ScanOptions`, `ScanResult`, `AnalyzerConfig` — see `packages/core/src/`.
- `ScanEngine` / `AnalyzerClient`: a working (not stubbed-out) orchestrator implementing the
  initialize → discover → index → analyze → correlate → finalize lifecycle, driven by pluggable
  `RepositoryDiscoverer` / `ProjectIndexer` / `FindingCorrelator` / `RiskCalculator` strategies.
  Covered by `tests/core/scan-engine.test.ts` (3 passing tests) using fixture strategies — no real
  discovery/parsing exists yet, which is correct for Phase 0.
- Event model (`ScanEvent` union), error/diagnostic model, structured logging contract.
- ADRs: see `docs/decisions/`.
- `.claude/` development-agent configuration: `CLAUDE.md`, agents, skills, commands.

## In-progress components

None — Phase 0 core deliverable is complete pending human review.

## Blocked components

None.

## Known architectural decisions

- See `docs/decisions/ADR-0001-monorepo-package-architecture.md` through `ADR-0004`.
- Notably: the `Analyzer` name collision between the Section 37C rule contract and the Section 3
  facade class is resolved by naming the facade `AnalyzerClient` (ADR-0002).

## Known technical debt

- Stub packages (`project-model`, `parser`, `graph`, `analyzers`, `engines`, `integrations`, `ai`,
  `plugins`, `cli`) contain only `package.json` + empty `src/index.ts` — intentional per Section 37
  ("do not move into Phase 1 until Phase 0 architecture is internally coherent").
- No persistent cache/incremental-analysis implementation yet (`IncrementalConfig` is a contract
  only) — planned for Phase 1/Section 29.
- No SARIF/HTML exporters implemented — `ResultExporter` is a contract only.
- Reasoning provider abstraction (`ReasoningProviderConfig`) has no concrete provider yet — planned
  for `packages/ai` once deterministic analyzers exist to feed it (Section 24).

## Next approved tasks

See `docs/tasks/`. Phase 1 tasks are drafted but **not yet approved to start** — human sign-off on
Phase 0 is the gate (Section 37: "Do not move into Phase 1 until Phase 0 architecture is internally
coherent").
