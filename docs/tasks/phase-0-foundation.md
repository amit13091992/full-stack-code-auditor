# Task: Phase 0 — Foundation & Contracts

## Objective

Establish the package architecture, domain model, core TypeScript contracts, analyzer lifecycle,
event/error/config/serialization/plugin models, and the Claude Code development-agent configuration
— with no analysis logic — so that Phase 1+ implementation has a stable, reviewed target.

## Scope

- Monorepo scaffold (pnpm workspace, 10 packages, shared `tsconfig.base.json`).
- `@code-analyzer/core`: domain model (16 entities per Section 37B), `Graph` contract, `Analyzer`/
  `AnalyzerContext`/`AnalysisResult`/`AnalyzerRegistry` contracts, `ScanEngine` lifecycle
  orchestrator + `AnalyzerClient` facade, event model, error/diagnostic model, config model,
  serialization (`ScanResult`) format, plugin (`AnalyzerPlugin`/`PluginHost`) model.
- Stub packages for `project-model`, `parser`, `graph`, `analyzers`, `engines`, `integrations`,
  `ai`, `plugins`, `cli` — boundary + dependency direction only.
- `docs/`: architecture, domain-model, analyzer-engine, graph, parser, security, testing overviews;
  ADR-0001 through ADR-0004; `project-status.md`; this task spec.
- `.claude/`: `CLAUDE.md`, 9 agent definitions, 8 skills, 6 commands, 3 hooks, `settings.json`.
- Test coverage for the `ScanEngine` lifecycle contract using fixture strategies.

## Non-goals

- Any concrete analyzer (security, architecture, quality, performance, dependency, secrets,
  infrastructure).
- Real repository discovery, parsing, or graph construction.
- AI provider integration.
- CLI argument parsing / actual command implementations.
- Persistence/caching for incremental analysis (contract only: `IncrementalConfig`).

## Dependencies

None — this is the first task.

## Files / packages affected

Entire repository (initial creation).

## Interface changes

N/A (initial contracts). Future changes to any interface listed in Section 37C must go through
ADR + Section 46's "inspect all consumers" process.

## Implementation requirements

- `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true` in
  `tsconfig.base.json` — domain model correctness depends on the compiler catching accidental
  optionality/undefined handling mistakes early (Section 5/35).
- Every domain entity field is `readonly`.
- `core` has zero `@code-analyzer/*` dependencies.
- `ScanEngine` must actually run (not be a documented-but-unimplemented stub) against
  caller-supplied `RepositoryDiscoverer`/`ProjectIndexer` strategies, so Phase 0 produces something
  testable, per Section 37's acceptance-criteria expectation.

## Tests

`tests/core/scan-engine.test.ts` — see `docs/testing/strategy.md`.

## Acceptance criteria

- [x] `pnpm install` succeeds.
- [x] `npx tsc -b packages/<every package>` succeeds with zero errors.
- [x] `pnpm test` passes (3/3 in Phase 0's `scan-engine.test.ts`).
- [x] Every entity named in Section 37B exists as a TypeScript interface in `packages/core/src/domain`.
- [x] Every contract named in Section 37C exists in `packages/core/src`.
- [x] `docs/decisions/` contains an ADR for every deliberate deviation from a literal reading of the
      prompt (the `Analyzer` naming collision, the graph-database decision, the finding/evidence
      split, the package boundaries).
- [x] `docs/project-status.md` accurately reflects what is and isn't built.
- [x] `.claude/` structure exists and `CLAUDE.md` references (not duplicates) the deeper docs.
- [ ] Human review/sign-off recorded in `docs/project-status.md` before Phase 1 begins (Section 37:
      "Do not move into Phase 1 until the Phase 0 architecture is internally coherent" — this is a
      human gate, not something an agent self-certifies).
